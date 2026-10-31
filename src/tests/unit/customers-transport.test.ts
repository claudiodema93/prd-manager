// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MessageChannel } from "node:worker_threads";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import type { RouterClient } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { customers as customersTable } from "@/db/schema";
import { customers } from "@/ipc/customers";

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  folders: {
    articlesDirectory: null as string | null,
    issuesDirectory: null as string | null,
    trashDirectory: null as string | null,
  },
}));

vi.mock("@/db", () => ({
  getDatabase: () => state.db,
}));

vi.mock("@/preferences/store", () => ({
  getFoldersPreference: () => ({ ...state.folders }),
}));

const schema = { customers: customersTable };
type TestDatabase = ReturnType<typeof drizzle<typeof schema>>;

const testRouter = { customers };
type TestClient = RouterClient<typeof testRouter>;

interface TestParameters {
  readonly [name: string]: {
    readonly default?: string;
    readonly required: boolean;
    readonly type: "bool" | "number" | "text";
  };
}

interface TestSection {
  readonly key: string;
  readonly parameters: TestParameters;
  readonly schemaVersion: number;
}

const ARTICLE_SECTION: TestSection = {
  key: "{CODE}[_EVO{EVO:00}]",
  parameters: {
    CODE: { required: true, type: "text" },
    EVO: { default: "0", required: true, type: "number" },
  },
  schemaVersion: 1,
};

const REVISION_SECTION: TestSection = {
  key: "REV_{REV}",
  parameters: {
    REV: { default: "0", required: true, type: "number" },
  },
  schemaVersion: 1,
};

const CONFIG_FILE_NAME = "customer_data.json";

const EMPTY_SCAN_RESULT = {
  created: 0,
  issues: [],
  removed: 0,
  root: null,
  scanned: 0,
  unchanged: 0,
  updated: 0,
};

/** Fresh copies so a mutation in one call cannot leak into the next. */
function copySection(section: TestSection): TestSection {
  return {
    key: section.key,
    parameters: { ...section.parameters },
    schemaVersion: section.schemaVersion,
  };
}

function customerInput(
  overrides: {
    article?: TestSection;
    customerCode?: string;
    name?: string;
    revision?: TestSection;
  } = {}
) {
  return {
    article: overrides.article ?? copySection(ARTICLE_SECTION),
    ...(overrides.customerCode === undefined
      ? {}
      : { customerCode: overrides.customerCode }),
    name: overrides.name ?? "Acme",
    revision: overrides.revision ?? copySection(REVISION_SECTION),
  };
}

let sqlite: Database.Database;
let client: TestClient;
let clientPort: MessageChannel["port1"];
let serverPort: MessageChannel["port2"];
let articlesDirectory: string;
let trashDirectory: string;
let tempDirectories: string[];

beforeEach(async () => {
  sqlite = new Database(":memory:");
  const database: TestDatabase = drizzle({ client: sqlite, schema });
  migrate(database, {
    migrationsFolder: path.resolve(import.meta.dirname, "../../../drizzle"),
  });
  state.db = database;

  articlesDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "customers-transport-")
  );
  trashDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "customers-transport-trash-")
  );
  tempDirectories = [articlesDirectory, trashDirectory];

  state.folders = {
    articlesDirectory,
    issuesDirectory: null,
    trashDirectory,
  };

  const channel = new MessageChannel();
  clientPort = channel.port1;
  serverPort = channel.port2;

  // The real oRPC peers: RPC handler on the server port, RPC link on the
  // client port, exactly as Electron wires them up in main/preload/renderer.
  new RPCHandler(testRouter).upgrade(serverPort);
  client = createORPCClient<TestClient>(new RPCLink({ port: clientPort }));

  clientPort.start();
  serverPort.start();
});

afterEach(async () => {
  clientPort.close();
  serverPort.close();
  sqlite.close();

  await Promise.all(
    tempDirectories.map((directory) =>
      fs.rm(directory, { force: true, recursive: true })
    )
  );
});

describe("customers transport", () => {
  it("returns an empty scan result when no articles directory is configured", async () => {
    state.folders = {
      articlesDirectory: null,
      issuesDirectory: null,
      trashDirectory: null,
    };

    await expect(client.customers.scanCustomers({})).resolves.toEqual(
      EMPTY_SCAN_RESULT
    );
  });

  it("creates a customer and returns a JSON-safe row", async () => {
    const created = await client.customers.createCustomer(customerInput());

    expect(created).toMatchObject({
      articleCount: 0,
      customerCode: "0001",
      folderName: "customer-0001",
      folderPath: path.join(articlesDirectory, "customer-0001"),
    });
    expect(created.metadataJson).toMatchObject({
      article: { key: ARTICLE_SECTION.key },
      articleCount: 0,
      issues: [],
      revision: { key: REVISION_SECTION.key },
    });
    expect(typeof created.createdAt).toBe("number");
    expect(typeof created.updatedAt).toBe("number");
    expect(created.createdAt).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(created))).toEqual(created);
  });

  it("returns the typed metadata on getCustomer", async () => {
    const created = await client.customers.createCustomer(customerInput());

    const detail = await client.customers.getCustomer({
      folderPath: created.folderPath,
    });

    expect(detail?.metadataJson?.article).toMatchObject({
      key: ARTICLE_SECTION.key,
      schemaVersion: 1,
    });
    expect(detail?.metadataJson?.article?.parameters.CODE).toMatchObject({
      required: true,
      type: "text",
    });
    expect(detail?.metadataJson?.revision?.key).toBe(REVISION_SECTION.key);
    expect(JSON.parse(JSON.stringify(detail))).toEqual(detail);
  });

  it("lists summaries without metadata and stays JSON-safe", async () => {
    await client.customers.createCustomer(customerInput());

    const page = await client.customers.listCustomers({});

    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ articleCount: 0 });
    expect(page.items[0]).not.toHaveProperty("metadataJson");
    expect(typeof page.items[0]?.createdAt).toBe("number");
    expect(typeof page.items[0]?.updatedAt).toBe("number");
    expect(JSON.parse(JSON.stringify(page))).toEqual(page);
  });

  it("reconciles an unchanged customer on scan", async () => {
    await client.customers.createCustomer(customerInput());

    await expect(client.customers.scanCustomers({})).resolves.toMatchObject({
      created: 0,
      issues: [],
      removed: 0,
      root: articlesDirectory,
      scanned: 1,
      unchanged: 1,
      updated: 0,
    });
  });

  it("updates the name on disk and in the cache", async () => {
    const created = await client.customers.createCustomer(customerInput());

    const updated = await client.customers.updateCustomer({
      folderPath: created.folderPath,
      name: "Beta",
    });

    expect(updated.name).toBe("Beta");

    const raw = await fs.readFile(
      path.join(created.folderPath, CONFIG_FILE_NAME),
      "utf8"
    );
    expect(JSON.parse(raw)).toMatchObject({ customerName: "Beta" });
  });

  it("moves a removed customer into the trash and prunes the cache", async () => {
    const created = await client.customers.createCustomer(customerInput());

    await expect(
      client.customers.removeCustomer({ folderPath: created.folderPath })
    ).resolves.toBe(created.folderPath);

    await expect(
      fs.lstat(path.join(trashDirectory, "customer-0001"))
    ).resolves.toBeDefined();
    await expect(fs.lstat(created.folderPath)).rejects.toMatchObject({
      code: "ENOENT",
    });

    await expect(client.customers.listCustomers({})).resolves.toEqual({
      items: [],
      total: 0,
    });
  });

  it("clears cached rows and returns the deleted count", async () => {
    await expect(client.customers.clearCustomers()).resolves.toBe(0);

    await client.customers.createCustomer(customerInput());

    await expect(client.customers.clearCustomers()).resolves.toBe(1);
    await expect(client.customers.listCustomers({})).resolves.toEqual({
      items: [],
      total: 0,
    });
  });

  it("maps a missing articles directory to PRECONDITION_FAILED", async () => {
    state.folders = { ...state.folders, articlesDirectory: null };

    await expect(
      client.customers.createCustomer(customerInput())
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("maps a taken customer code to CONFLICT", async () => {
    await client.customers.createCustomer(
      customerInput({ customerCode: "0001" })
    );

    await expect(
      client.customers.createCustomer(
        customerInput({ customerCode: "0001", name: "Beta" })
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("maps a missing customer folder on update to NOT_FOUND", async () => {
    await expect(
      client.customers.updateCustomer({
        folderPath: path.join(articlesDirectory, "customer-9999"),
        name: "Nobody",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maps an invalid key template to BAD_REQUEST", async () => {
    const invalidArticle: TestSection = {
      key: "LITERAL",
      parameters: {
        CODE: { required: true, type: "text" },
      },
      schemaVersion: 1,
    };

    await expect(
      client.customers.createCustomer(
        customerInput({ article: invalidArticle })
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(fs.readdir(articlesDirectory)).resolves.toEqual([]);
  });

  it("keeps the customer lifecycle coherent around a real article", async () => {
    const folderPath = path.join(articlesDirectory, "customer-0001");
    const articleFolder = path.join(folderPath, "A_01");

    await fs.mkdir(articleFolder, { recursive: true });
    await fs.writeFile(
      path.join(folderPath, CONFIG_FILE_NAME),
      JSON.stringify({
        article: copySection(ARTICLE_SECTION),
        customerName: "Acme",
        revision: copySection(REVISION_SECTION),
        schemaVersion: 1,
      })
    );
    await fs.writeFile(
      path.join(articleFolder, "article_data.json"),
      JSON.stringify({
        CODE: "A",
        customer: 1,
        EVO: "1",
        schemaVersion: 1,
      })
    );

    const firstScan = await client.customers.scanCustomers({});

    expect(firstScan).toMatchObject({ created: 1, scanned: 1 });

    const page = await client.customers.listCustomers({});

    expect(page.total).toBe(1);
    expect(page.items[0]?.articleCount).toBe(1);

    // A non-key parameter stays editable while articles exist.
    const updated = await client.customers.updateCustomer({
      article: {
        ...copySection(ARTICLE_SECTION),
        parameters: {
          CODE: { required: true, type: "text" },
          EVO: { default: "1", required: true, type: "number" },
        },
      },
      folderPath,
    });

    expect(updated.articleCount).toBe(1);
    expect(updated.metadataJson?.article?.parameters.EVO?.default).toBe("1");

    await expect(
      client.customers.updateCustomer({
        article: {
          ...copySection(ARTICLE_SECTION),
          key: "UPD_{CODE}[_EVO{EVO:00}]",
        },
        folderPath,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(
      client.customers.removeCustomer({ folderPath })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await fs.rm(articleFolder, { force: true, recursive: true });

    const secondScan = await client.customers.scanCustomers({});

    expect(secondScan).toMatchObject({
      created: 0,
      scanned: 1,
      unchanged: 0,
      updated: 1,
    });
    expect(JSON.parse(JSON.stringify(secondScan))).toEqual(secondScan);

    await expect(client.customers.removeCustomer({ folderPath })).resolves.toBe(
      folderPath
    );
    await expect(
      fs.lstat(path.join(trashDirectory, "customer-0001"))
    ).resolves.toBeDefined();
    await expect(fs.lstat(folderPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(client.customers.listCustomers({})).resolves.toEqual({
      items: [],
      total: 0,
    });
  });
});
