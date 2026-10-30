// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CUSTOMER_CONFIG_SCHEMA_VERSION } from "@/customers/config";
import {
  type CustomerServiceContext,
  createCustomer,
  removeCustomer,
  type UpdateCustomerInput,
  updateCustomer,
} from "@/customers/crud";
import {
  type CustomerDatabase,
  deleteCustomerRow,
  getCustomerRow,
} from "@/customers/store";
import type { CustomerSectionDefinition } from "@/customers/types";
import { customers } from "@/db/schema";

const CONFIG_FILE = "customer_data.json";
const ARTICLE_FILE = "article_data.json";
const HAS_ARTICLES_PATTERN = /1 valid article/u;
const schema = { customers };

type TestDatabase = ReturnType<typeof drizzle<typeof schema>>;

function makeArticle(
  overrides: { key?: string; required?: boolean } = {}
): CustomerSectionDefinition {
  return {
    key: overrides.key ?? "ART-{NUM:0000}",
    parameters: {
      NUM: { required: overrides.required ?? true, type: "number" },
    },
    schemaVersion: CUSTOMER_CONFIG_SCHEMA_VERSION,
  };
}

function makeRevision(
  overrides: { key?: string } = {}
): CustomerSectionDefinition {
  return {
    key: overrides.key ?? "REV-{NUM:0000}",
    parameters: {
      NUM: { required: true, type: "number" },
    },
    schemaVersion: CUSTOMER_CONFIG_SCHEMA_VERSION,
  };
}

let tempDir: string;
let root: string;
let trash: string;
let sqlite: Database.Database;
let database: TestDatabase;
let context: CustomerServiceContext;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "customers-crud-"));
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

function customerFolder(code: string): string {
  return path.join(root, `customer-${code}`);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function readConfigFile(
  folderPath: string
): Promise<Record<string, unknown>> {
  const contents = await fs.readFile(
    path.join(folderPath, CONFIG_FILE),
    "utf8"
  );

  return JSON.parse(contents) as Record<string, unknown>;
}

async function writeValidConfig(
  folderPath: string,
  name: string
): Promise<void> {
  await fs.writeFile(
    path.join(folderPath, CONFIG_FILE),
    JSON.stringify({
      article: makeArticle(),
      customerName: name,
      revision: makeRevision(),
      schemaVersion: CUSTOMER_CONFIG_SCHEMA_VERSION,
    })
  );
}

async function addValidArticle(
  folderPath: string,
  customerCode: string,
  name = "article-1"
): Promise<void> {
  const articlePath = path.join(folderPath, name);

  await fs.mkdir(articlePath, { recursive: true });
  await fs.writeFile(
    path.join(articlePath, ARTICLE_FILE),
    JSON.stringify({ customer: customerCode, schemaVersion: 1 })
  );
}

async function addMalformedArticle(
  folderPath: string,
  name = "broken"
): Promise<void> {
  await fs.mkdir(path.join(folderPath, name), { recursive: true });
}

function createDefault(
  overrides: { customerCode?: string; name?: string } = {}
) {
  return createCustomer(context, {
    article: makeArticle(),
    name: overrides.name ?? "Acme",
    revision: makeRevision(),
    ...(overrides.customerCode === undefined
      ? {}
      : { customerCode: overrides.customerCode }),
  });
}

describe("createCustomer", () => {
  it("uses 0001 for the first customer and writes the on-disk shape", async () => {
    const record = await createDefault({ name: "  Acme  " });

    expect(record).toMatchObject({
      articleSchemaVersion: CUSTOMER_CONFIG_SCHEMA_VERSION,
      customerCode: "0001",
      folderName: "customer-0001",
      folderPath: customerFolder("0001"),
      name: "Acme",
      revisionSchemaVersion: CUSTOMER_CONFIG_SCHEMA_VERSION,
      schemaVersion: CUSTOMER_CONFIG_SCHEMA_VERSION,
      status: "ok",
    });
    expect(record.metadataJson).toMatchObject({
      article: { key: "ART-{NUM:0000}" },
      articleCount: 0,
      issues: [],
      revision: { key: "REV-{NUM:0000}" },
    });

    expect((await fs.lstat(record.folderPath)).isDirectory()).toBe(true);

    const raw = await fs.readFile(
      path.join(record.folderPath, CONFIG_FILE),
      "utf8"
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    expect(parsed.customerName).toBe("Acme");
    expect(parsed).not.toHaveProperty("name");
    expect(raw).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
    expect(raw).toContain('\n  "customerName"');

    expect(getCustomerRow(database, record.folderPath)).toMatchObject({
      customerCode: "0001",
      name: "Acme",
      status: "ok",
    });
  });

  it("honours an explicitly requested customer code", async () => {
    const record = await createDefault({ customerCode: "0042" });

    expect(record.folderName).toBe("customer-0042");
    expect(record.folderPath).toBe(customerFolder("0042"));
    expect(await pathExists(customerFolder("0042"))).toBe(true);
  });

  it("allocates the next free code when the first one is taken", async () => {
    const first = await createDefault();
    const second = await createDefault({ name: "Beta" });

    expect(first.customerCode).toBe("0001");
    expect(second.customerCode).toBe("0002");
    expect(await pathExists(customerFolder("0002"))).toBe(true);
  });

  it("rejects invalid customer codes", async () => {
    await expect(createDefault({ customerCode: "12" })).rejects.toMatchObject({
      code: "CUSTOMER_CODE_INVALID",
    });

    await expect(createDefault({ customerCode: "0000" })).rejects.toMatchObject(
      { code: "CUSTOMER_CODE_INVALID" }
    );
  });

  it("rejects a code whose folder already exists", async () => {
    await fs.mkdir(customerFolder("0001"));

    await expect(createDefault({ customerCode: "0001" })).rejects.toMatchObject(
      { code: "CUSTOMER_CODE_TAKEN" }
    );
  });

  it("reports a missing articles directory", async () => {
    context = {
      ...context,
      articlesDirectory: path.join(tempDir, "missing"),
    };

    await expect(createDefault()).rejects.toMatchObject({
      code: "ROOT_NOT_FOUND",
    });
  });

  it("reports an unconfigured articles directory", async () => {
    context = { ...context, articlesDirectory: null };

    await expect(createDefault()).rejects.toMatchObject({
      code: "ROOT_NOT_CONFIGURED",
    });
  });

  it("rejects an empty or oversized customer name", async () => {
    await expect(createDefault({ name: "   " })).rejects.toMatchObject({
      code: "CUSTOMER_NAME_INVALID",
    });
    await expect(
      createDefault({ name: "a".repeat(257) })
    ).rejects.toMatchObject({ code: "CUSTOMER_NAME_INVALID" });
  });
});

describe("updateCustomer", () => {
  it("persists a name change to the file and the cache row", async () => {
    const created = await createDefault();

    const updated = await updateCustomer(context, {
      folderPath: created.folderPath,
      name: "Beta",
    });

    expect(updated.name).toBe("Beta");
    expect(getCustomerRow(database, created.folderPath)?.name).toBe("Beta");

    const config = await readConfigFile(created.folderPath);

    expect(config.customerName).toBe("Beta");
    expect(config.article).toMatchObject({ key: "ART-{NUM:0000}" });
    expect(config.revision).toMatchObject({ key: "REV-{NUM:0000}" });
  });

  it("allows an article key change when the customer has no articles", async () => {
    const created = await createDefault();

    const updated = await updateCustomer(context, {
      article: makeArticle({ key: "NEW-{NUM:0000}" }),
      folderPath: created.folderPath,
    });

    expect(updated.metadataJson).toMatchObject({
      article: { key: "NEW-{NUM:0000}" },
      articleCount: 0,
    });
    expect((await readConfigFile(created.folderPath)).article).toMatchObject({
      key: "NEW-{NUM:0000}",
    });
  });

  it("locks the article key while valid articles exist", async () => {
    const created = await createDefault();
    await addValidArticle(created.folderPath, created.customerCode);

    await expect(
      updateCustomer(context, {
        article: makeArticle({ key: "NEW-{NUM:0000}" }),
        folderPath: created.folderPath,
      })
    ).rejects.toMatchObject({
      code: "KEY_LOCKED",
      message: "The article key cannot change while the customer has articles.",
    });
  });

  it("locks the revision key while valid articles exist", async () => {
    const created = await createDefault();
    await addValidArticle(created.folderPath, created.customerCode);

    await expect(
      updateCustomer(context, {
        folderPath: created.folderPath,
        revision: makeRevision({ key: "NEWREV-{NUM:0000}" }),
      })
    ).rejects.toMatchObject({
      code: "KEY_LOCKED",
      message:
        "The revision key cannot change while the customer has articles.",
    });
  });

  it("allows non-key parameter changes while articles exist", async () => {
    const created = await createDefault();
    await addValidArticle(created.folderPath, created.customerCode);

    const updated = await updateCustomer(context, {
      article: makeArticle({ required: false }),
      folderPath: created.folderPath,
    });

    expect(updated.metadataJson).toMatchObject({
      article: {
        key: "ART-{NUM:0000}",
        parameters: { NUM: { required: false } },
      },
      articleCount: 1,
    });
    expect((await readConfigFile(created.folderPath)).article).toMatchObject({
      key: "ART-{NUM:0000}",
      parameters: { NUM: { required: false } },
    });
  });

  it("reports a missing customer folder", async () => {
    await expect(
      updateCustomer(context, {
        folderPath: customerFolder("9999"),
        name: "Nobody",
      })
    ).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND" });
  });

  it("rejects a folder outside the articles directory", async () => {
    await expect(
      updateCustomer(context, {
        folderPath: path.join(tempDir, "elsewhere"),
        name: "Outside",
      })
    ).rejects.toMatchObject({ code: "INVALID_OPERATION" });
  });

  it("propagates CONFIG_INVALID_JSON when the config is broken and articles exist", async () => {
    const created = await createDefault();
    await addValidArticle(created.folderPath, created.customerCode);
    await fs.writeFile(
      path.join(created.folderPath, CONFIG_FILE),
      "{ not json"
    );

    await expect(
      updateCustomer(context, {
        folderPath: created.folderPath,
        name: "Beta",
      })
    ).rejects.toMatchObject({ code: "CONFIG_INVALID_JSON" });
  });

  it("repairs a broken config without articles when full input is supplied", async () => {
    const created = await createDefault();
    await fs.writeFile(
      path.join(created.folderPath, CONFIG_FILE),
      "{ not json"
    );

    const updated = await updateCustomer(context, {
      article: makeArticle({ key: "FIX-{NUM:0000}" }),
      folderPath: created.folderPath,
      name: "Repaired",
      revision: makeRevision({ key: "FIXREV-{NUM:0000}" }),
    });

    expect(updated.name).toBe("Repaired");
    expect((await readConfigFile(created.folderPath)).customerName).toBe(
      "Repaired"
    );
    expect((await readConfigFile(created.folderPath)).article).toMatchObject({
      key: "FIX-{NUM:0000}",
    });
  });

  it("requires full input to repair a missing config", async () => {
    const created = await createDefault();
    await fs.rm(path.join(created.folderPath, CONFIG_FILE));

    await expect(
      updateCustomer(context, {
        folderPath: created.folderPath,
        name: "OnlyName",
      })
    ).rejects.toMatchObject({ code: "INVALID_OPERATION" });
  });

  it.skipIf(process.platform === "win32")(
    "repairs a symlinked config when there are no articles",
    async () => {
      const created = await createDefault();
      const configPath = path.join(created.folderPath, CONFIG_FILE);
      const outsideConfig = path.join(tempDir, "outside-config.json");

      await fs.writeFile(outsideConfig, "{}");
      await fs.rm(configPath);
      await fs.symlink(outsideConfig, configPath);

      const updated = await updateCustomer(context, {
        article: makeArticle(),
        folderPath: created.folderPath,
        name: "Repaired",
        revision: makeRevision(),
      });

      expect(updated.name).toBe("Repaired");
      expect((await fs.lstat(configPath)).isSymbolicLink()).toBe(false);
      expect((await readConfigFile(created.folderPath)).customerName).toBe(
        "Repaired"
      );
    }
  );

  it.skipIf(process.platform === "win32")(
    "reports CONFIG_UNREADABLE for a symlinked config when articles exist",
    async () => {
      const created = await createDefault();
      const configPath = path.join(created.folderPath, CONFIG_FILE);
      const outsideConfig = path.join(tempDir, "outside-config.json");

      await addValidArticle(created.folderPath, created.customerCode);
      await fs.writeFile(outsideConfig, "{}");
      await fs.rm(configPath);
      await fs.symlink(outsideConfig, configPath);

      await expect(
        updateCustomer(context, {
          folderPath: created.folderPath,
          name: "Blocked",
        })
      ).rejects.toMatchObject({ code: "CONFIG_UNREADABLE" });
    }
  );

  it("never changes the customer code or folder name", async () => {
    const created = await createDefault({ customerCode: "0003" });

    const updated = await updateCustomer(context, {
      customerCode: "0004",
      folderPath: created.folderPath,
      name: "Gamma",
    } as unknown as UpdateCustomerInput);

    expect(updated.customerCode).toBe("0003");
    expect(updated.folderName).toBe("customer-0003");
    expect(updated.folderPath).toBe(created.folderPath);
    expect(await fs.readdir(root)).toEqual(["customer-0003"]);
  });
});

describe("removeCustomer", () => {
  it("moves a customer without articles to trash and deletes the row", async () => {
    const created = await createDefault();

    await expect(
      removeCustomer(context, { folderPath: created.folderPath })
    ).resolves.toBe(created.folderPath);

    expect(await pathExists(created.folderPath)).toBe(false);
    expect(await pathExists(path.join(trash, created.folderName))).toBe(true);
    expect(getCustomerRow(database, created.folderPath)).toBeNull();
  });

  it("refuses to remove a customer that has valid articles", async () => {
    const created = await createDefault();
    await addValidArticle(created.folderPath, created.customerCode);

    await expect(
      removeCustomer(context, { folderPath: created.folderPath })
    ).rejects.toMatchObject({
      code: "CUSTOMER_HAS_ARTICLES",
      message: expect.stringContaining(created.folderName),
    });
    await expect(
      removeCustomer(context, { folderPath: created.folderPath })
    ).rejects.toThrow(HAS_ARTICLES_PATTERN);
    expect(await pathExists(created.folderPath)).toBe(true);
  });

  it("does not let malformed article folders block the removal", async () => {
    const created = await createDefault();
    await addMalformedArticle(created.folderPath);

    await expect(
      removeCustomer(context, { folderPath: created.folderPath })
    ).resolves.toBe(created.folderPath);

    expect(await pathExists(path.join(trash, created.folderName))).toBe(true);
  });

  it("refuses a trash directory inside the articles directory", async () => {
    const created = await createDefault();
    const nestedTrash = path.join(root, "trash");

    await fs.mkdir(nestedTrash);
    context = { ...context, trashDirectory: nestedTrash };

    await expect(
      removeCustomer(context, { folderPath: created.folderPath })
    ).rejects.toMatchObject({ code: "INVALID_OPERATION" });
    expect(await pathExists(created.folderPath)).toBe(true);
  });

  it("requires a configured trash directory", async () => {
    const created = await createDefault();
    context = { ...context, trashDirectory: null };

    await expect(
      removeCustomer(context, { folderPath: created.folderPath })
    ).rejects.toMatchObject({ code: "TRASH_NOT_CONFIGURED" });
    expect(await pathExists(created.folderPath)).toBe(true);
  });

  it("reports a missing source folder", async () => {
    await expect(
      removeCustomer(context, { folderPath: customerFolder("9999") })
    ).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND" });
  });

  it("removes the folder even when the cache row is missing", async () => {
    const created = await createDefault();
    deleteCustomerRow(database, created.folderPath);

    await expect(
      removeCustomer(context, { folderPath: created.folderPath })
    ).resolves.toBe(created.folderPath);
    expect(await pathExists(path.join(trash, created.folderName))).toBe(true);
  });

  it("rejects a folder outside the articles directory", async () => {
    await expect(
      removeCustomer(context, { folderPath: path.join(tempDir, "elsewhere") })
    ).rejects.toMatchObject({ code: "INVALID_OPERATION" });
  });
});

describe("path safety", () => {
  it.skipIf(process.platform === "win32")(
    "rejects a path that escapes the root through an intermediate symlink",
    async () => {
      const outsideDir = path.join(tempDir, "outside-link-target");
      const linkPath = path.join(root, "link");
      const outsideCustomer = path.join(outsideDir, "customer-0001");

      await fs.mkdir(outsideCustomer, { recursive: true });
      await writeValidConfig(outsideCustomer, "Outside");
      await fs.symlink(outsideDir, linkPath, "dir");

      const escapedPath = path.join(linkPath, "customer-0001");

      await expect(
        updateCustomer(context, { folderPath: escapedPath, name: "Changed" })
      ).rejects.toMatchObject({ code: "INVALID_OPERATION" });
      await expect(
        removeCustomer(context, { folderPath: escapedPath })
      ).rejects.toMatchObject({ code: "INVALID_OPERATION" });

      expect(await readConfigFile(outsideCustomer)).toMatchObject({
        customerName: "Outside",
      });
      expect(await pathExists(outsideCustomer)).toBe(true);
    }
  );

  it.skipIf(process.platform === "win32")(
    "rejects a customer folder that is a symlink",
    async () => {
      const outsideDir = path.join(tempDir, "outside-final-target");
      const linkPath = customerFolder("0001");

      await fs.mkdir(outsideDir);
      await fs.symlink(outsideDir, linkPath, "dir");

      await expect(
        updateCustomer(context, { folderPath: linkPath, name: "Changed" })
      ).rejects.toMatchObject({ code: "CUSTOMER_FOLDER_SYMLINK" });
      await expect(
        removeCustomer(context, { folderPath: linkPath })
      ).rejects.toMatchObject({ code: "CUSTOMER_FOLDER_SYMLINK" });
    }
  );

  it.skipIf(process.platform === "win32")(
    "rejects a root that is a symlink",
    async () => {
      const target = path.join(tempDir, "real-root");
      const linkRoot = path.join(tempDir, "root-link");

      await fs.mkdir(target);
      await fs.symlink(target, linkRoot, "dir");
      context = { ...context, articlesDirectory: linkRoot };

      await expect(createDefault()).rejects.toMatchObject({
        code: "ROOT_SYMLINK",
      });
      await expect(
        updateCustomer(context, {
          folderPath: path.join(linkRoot, "customer-0001"),
          name: "Changed",
        })
      ).rejects.toMatchObject({ code: "ROOT_SYMLINK" });
    }
  );

  it("rejects a root that is a regular file", async () => {
    const fileRoot = path.join(tempDir, "root-file");

    await fs.writeFile(fileRoot, "not a directory");
    context = { ...context, articlesDirectory: fileRoot };

    await expect(createDefault()).rejects.toMatchObject({
      code: "ROOT_NOT_DIRECTORY",
    });
  });

  it("rejects a customer path that is a regular file", async () => {
    const filePath = customerFolder("0001");

    await fs.writeFile(filePath, "not a directory");

    await expect(
      updateCustomer(context, { folderPath: filePath, name: "Changed" })
    ).rejects.toMatchObject({ code: "CUSTOMER_FOLDER_NOT_DIRECTORY" });
    await expect(
      removeCustomer(context, { folderPath: filePath })
    ).rejects.toMatchObject({ code: "CUSTOMER_FOLDER_NOT_DIRECTORY" });
  });

  it("rejects a folderPath containing a NUL character", async () => {
    await expect(
      updateCustomer(context, {
        folderPath: `${customerFolder("0001")}\0`,
        name: "Changed",
      })
    ).rejects.toMatchObject({ code: "INVALID_OPERATION" });
  });
});
