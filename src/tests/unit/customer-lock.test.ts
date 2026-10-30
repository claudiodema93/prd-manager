// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CUSTOMER_CONFIG_SCHEMA_VERSION } from "@/customers/config";
import { type CustomerServiceContext, createCustomer } from "@/customers/crud";
import { withCustomerLock } from "@/customers/lock";
import { scanCustomers } from "@/customers/scan";
import {
  type CustomerDatabase,
  getCustomerRow,
  listCustomerRows,
} from "@/customers/store";
import type { CustomerSectionDefinition } from "@/customers/types";
import { customers } from "@/db/schema";

const schema = { customers };

type TestDatabase = ReturnType<typeof drizzle<typeof schema>>;

function makeArticle(): CustomerSectionDefinition {
  return {
    key: "ART-{NUM:0000}",
    parameters: {
      NUM: { required: true, type: "number" },
    },
    schemaVersion: CUSTOMER_CONFIG_SCHEMA_VERSION,
  };
}

function makeRevision(): CustomerSectionDefinition {
  return {
    key: "REV-{NUM:0000}",
    parameters: {
      NUM: { required: true, type: "number" },
    },
    schemaVersion: CUSTOMER_CONFIG_SCHEMA_VERSION,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

let tempDir: string;
let root: string;
let trash: string;
let sqlite: Database.Database;
let database: TestDatabase;
let context: CustomerServiceContext;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "customer-lock-"));
  root = path.join(tempDir, "customers");
  trash = path.join(tempDir, "trash");

  await fs.mkdir(root);
  await fs.mkdir(trash);

  sqlite = new Database(":memory:");
  database = drizzle({ client: sqlite, schema });
  migrate(database, {
    migrationsFolder: path.resolve(import.meta.dirname, "../../../drizzle"),
  });

  context = {
    articlesDirectory: root,
    db: database as CustomerDatabase,
    trashDirectory: trash,
  };
});

afterEach(async () => {
  sqlite.close();
  await fs.rm(tempDir, { force: true, recursive: true });
});

describe("withCustomerLock", () => {
  it("does not start the next operation until the current one finishes", async () => {
    const events: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withCustomerLock(async () => {
      events.push("a:start");
      await gate;
      events.push("a:end");
      return "a";
    });
    const second = withCustomerLock(() => {
      events.push("b:start");
      return Promise.resolve("b");
    });

    await delay(10);

    expect(events).toEqual(["a:start"]);

    release();

    await expect(Promise.all([first, second])).resolves.toEqual(["a", "b"]);
    expect(events).toEqual(["a:start", "a:end", "b:start"]);
  });

  it("keeps the chain usable after an operation rejects", async () => {
    const failing = withCustomerLock(() => Promise.reject(new Error("boom")));
    const recovered = withCustomerLock(() => Promise.resolve("recovered"));

    await expect(failing).rejects.toThrow("boom");
    await expect(recovered).resolves.toBe("recovered");
    await expect(withCustomerLock(() => Promise.resolve("next"))).resolves.toBe(
      "next"
    );
  });

  it("serialises a concurrent scan and create into a consistent cache", async () => {
    const [scan, created] = await Promise.all([
      scanCustomers({ db: database as CustomerDatabase, rootDirectory: root }),
      createCustomer(context, {
        article: makeArticle(),
        name: "Acme",
        revision: makeRevision(),
      }),
    ]);

    expect(scan.root).toBe(root);
    expect(created).toMatchObject({
      customerCode: "0001",
      folderName: "customer-0001",
      folderPath: path.join(root, "customer-0001"),
      name: "Acme",
      status: "ok",
    });

    const rows = listCustomerRows(database as CustomerDatabase);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      customerCode: "0001",
      folderPath: created.folderPath,
      name: "Acme",
      status: "ok",
    });
    expect((await fs.lstat(created.folderPath)).isDirectory()).toBe(true);

    const rescan = await scanCustomers({
      db: database as CustomerDatabase,
      rootDirectory: root,
    });

    expect(rescan).toMatchObject({ created: 0, removed: 0, scanned: 1 });
    expect(listCustomerRows(database as CustomerDatabase)).toHaveLength(1);
    expect(
      getCustomerRow(database as CustomerDatabase, created.folderPath)
    ).toMatchObject({ name: "Acme", status: "ok" });
  });
});
