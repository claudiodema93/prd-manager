// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { call, ORPCError } from "@orpc/server";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerServiceError } from "@/customers/errors";
import {
  type CustomerRecord,
  type UpsertCustomerRowInput,
  upsertCustomerRow,
} from "@/customers/store";
import type {
  CustomerCacheMetadata,
  CustomerSectionDefinition,
} from "@/customers/types";
import { customers } from "@/db/schema";
import {
  clearCustomers,
  createCustomer,
  getCustomer,
  listCustomers,
  removeCustomer,
  scanCustomers,
  updateCustomer,
} from "@/ipc/customers/handlers";

const state = vi.hoisted(() => ({ db: undefined as unknown }));

const preferencesState = vi.hoisted(() => ({
  folders: {
    articlesDirectory: null as string | null,
    issuesDirectory: null as string | null,
    trashDirectory: null as string | null,
  },
}));

vi.mock("@/db", () => ({
  getDatabase: () => {
    if (!state.db) {
      throw new Error(
        "Database has not been initialised. Call initDatabase() first."
      );
    }

    return state.db;
  },
}));

vi.mock("@/preferences/store", () => ({
  getFoldersPreference: () => ({ ...preferencesState.folders }),
}));

// Derive the database type locally so this test does not depend on the name of
// the type exported by `@/db`.
const schema = { customers };
type TestDatabase = ReturnType<typeof drizzle<typeof schema>>;

const CONFIG_FILE = "customer_data.json";
const ARTICLE_FILE = "article_data.json";
const CUSTOMER_CODE = "0001";
const FOLDER_NAME = "customer-0001";

const ARTICLE: CustomerSectionDefinition = {
  key: "ART-{NUM:0000}",
  parameters: {
    NUM: { required: true, type: "number" },
  },
  schemaVersion: 1,
};

const REVISION: CustomerSectionDefinition = {
  key: "REV-{NUM:0000}",
  parameters: {
    NUM: { required: true, type: "number" },
  },
  schemaVersion: 1,
};

function metadataWith(articleCount: number): CustomerCacheMetadata {
  return {
    article: ARTICLE,
    articleCount,
    issues: [],
    revision: REVISION,
  };
}

let sqlite: Database.Database;
let database: TestDatabase;
let tempDir: string;
let articlesDirectory: string;
let trashDirectory: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "customers-handlers-"));
  articlesDirectory = path.join(tempDir, "articles");
  trashDirectory = path.join(tempDir, "trash");

  await fs.mkdir(articlesDirectory);
  await fs.mkdir(trashDirectory);

  sqlite = new Database(":memory:");
  database = drizzle({ client: sqlite, schema });
  migrate(database, {
    migrationsFolder: path.resolve(import.meta.dirname, "../../../drizzle"),
  });
  state.db = database;

  preferencesState.folders = {
    articlesDirectory,
    issuesDirectory: null,
    trashDirectory,
  };
});

afterEach(async () => {
  sqlite.close();
  await fs.rm(tempDir, { force: true, recursive: true });
});

function seedCustomer(
  overrides: Partial<UpsertCustomerRowInput> = {}
): CustomerRecord {
  return upsertCustomerRow(database, {
    articleSchemaVersion: 1,
    customerCode: CUSTOMER_CODE,
    folderMtimeMs: 1_793_260_675_839,
    folderName: FOLDER_NAME,
    folderPath: path.resolve("/customers/customer-0001"),
    issues: [],
    metadata: metadataWith(0),
    name: "Acme Srl",
    revisionSchemaVersion: 1,
    schemaVersion: 1,
    status: "ok",
    ...overrides,
  });
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function writeCustomerConfig(folderPath: string): Promise<void> {
  await fs.mkdir(folderPath, { recursive: true });
  await fs.writeFile(
    path.join(folderPath, CONFIG_FILE),
    JSON.stringify({
      article: ARTICLE,
      customerName: "Acme",
      revision: REVISION,
      schemaVersion: 1,
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

function createDefault(overrides: { customerCode?: string } = {}) {
  return call(createCustomer, {
    article: ARTICLE,
    name: "Acme",
    revision: REVISION,
    ...(overrides.customerCode === undefined
      ? {}
      : { customerCode: overrides.customerCode }),
  });
}

describe("listCustomers", () => {
  it("returns an empty page", async () => {
    await expect(call(listCustomers, {})).resolves.toEqual({
      items: [],
      total: 0,
    });
  });

  it("applies the default pagination and honours limit and offset", async () => {
    seedCustomer({ customerCode: "0001", folderPath: "/customers/one" });
    seedCustomer({ customerCode: "0002", folderPath: "/customers/two" });
    seedCustomer({ customerCode: "0003", folderPath: "/customers/three" });

    const byDefault = await call(listCustomers, {});

    expect(byDefault.items).toHaveLength(3);
    expect(byDefault.total).toBe(3);

    const page = await call(listCustomers, { limit: 1, offset: 1 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.customerCode).toBe("0002");
    expect(page.total).toBe(3);

    const maxPage = await call(listCustomers, { limit: 500 });

    expect(maxPage.items).toHaveLength(3);
  });

  it("searches case-insensitively across code, folder and name", async () => {
    seedCustomer({
      customerCode: "ACME-001",
      folderName: "Acme Srl",
      folderPath: "/customers/acme",
      name: "Acme",
    });
    seedCustomer({
      customerCode: "BETA-100%",
      folderName: "Beta",
      folderPath: "/customers/beta",
      name: "ACME Holdings",
    });
    seedCustomer({
      customerCode: "GAMMA",
      folderName: "Gamma",
      folderPath: "/customers/gamma",
      name: "Gamma",
      status: "warning",
    });

    const byCode = await call(listCustomers, { search: " acme " });
    const byFolder = await call(listCustomers, { search: "acme srl" });
    const byName = await call(listCustomers, { search: "holdings" });

    expect(byCode.items.map((item) => item.customerCode)).toEqual([
      "ACME-001",
      "BETA-100%",
    ]);
    expect(byCode.total).toBe(2);
    expect(byFolder.items.map((item) => item.customerCode)).toEqual([
      "ACME-001",
    ]);
    expect(byName.items.map((item) => item.customerCode)).toEqual([
      "BETA-100%",
    ]);
  });

  it("matches non-ASCII text regardless of case", async () => {
    seedCustomer({
      customerCode: "MÜLLER GmbH",
      folderName: "Müller",
      folderPath: "/customers/mueller",
    });
    seedCustomer({
      customerCode: "ÅNGSTRÖM",
      folderName: "Ångström",
      folderPath: "/customers/angstrom",
    });

    const mueller = await call(listCustomers, { search: "müller" });
    const angstrom = await call(listCustomers, { search: "ångström" });
    const upper = await call(listCustomers, { search: "MÜLLER" });

    expect(mueller.items.map((item) => item.customerCode)).toEqual([
      "MÜLLER GmbH",
    ]);
    expect(angstrom.items.map((item) => item.customerCode)).toEqual([
      "ÅNGSTRÖM",
    ]);
    expect(upper.items.map((item) => item.customerCode)).toEqual([
      "MÜLLER GmbH",
    ]);
  });

  it("matches composed and decomposed Unicode spellings", async () => {
    const composed = "Müller";
    const decomposed = composed.normalize("NFD");

    seedCustomer({
      customerCode: "NFD-001",
      folderName: decomposed,
      folderPath: "/customers/nfd",
    });
    seedCustomer({
      customerCode: "NFC-001",
      folderName: composed,
      folderPath: "/customers/nfc",
    });

    const viaComposed = await call(listCustomers, { search: composed });
    const viaDecomposed = await call(listCustomers, { search: decomposed });

    expect(viaComposed.items.map((item) => item.customerCode)).toEqual([
      "NFC-001",
      "NFD-001",
    ]);
    expect(viaDecomposed.items.map((item) => item.customerCode)).toEqual([
      "NFC-001",
      "NFD-001",
    ]);
  });

  it("filters by status and search together", async () => {
    seedCustomer({
      customerCode: "SHARED-OK",
      folderName: "Shared",
      folderPath: "/customers/shared-ok",
    });
    seedCustomer({
      customerCode: "SHARED-WARN",
      folderName: "Shared",
      folderPath: "/customers/shared-warn",
      status: "warning",
    });

    const result = await call(listCustomers, {
      search: "shared",
      status: "warning",
    });

    expect(result.items.map((item) => item.customerCode)).toEqual([
      "SHARED-WARN",
    ]);
    expect(result.total).toBe(1);
  });

  it("orders results deterministically by code, folder name and path", async () => {
    for (const folderPath of [
      "/customers/zeta",
      "/customers/alpha",
      "/customers/middle",
    ]) {
      seedCustomer({
        customerCode: "SAME-001",
        folderName: "Same",
        folderPath,
      });
    }

    const paths = (await call(listCustomers, {})).items.map(
      (item) => item.folderPath
    );

    expect(paths).toEqual([
      path.resolve("/customers/alpha"),
      path.resolve("/customers/middle"),
      path.resolve("/customers/zeta"),
    ]);
  });

  it("reads articleCount from metadata_json and omits the metadata itself", async () => {
    seedCustomer({ metadata: metadataWith(7) });

    const result = await call(listCustomers, {});

    expect(result.items[0]?.articleCount).toBe(7);
    expect(result.items[0]).not.toHaveProperty("metadataJson");
  });

  it("defaults articleCount to zero for legacy metadata", async () => {
    seedCustomer({
      metadata: { articles: 2 } as unknown as CustomerCacheMetadata,
    });

    const result = await call(listCustomers, {});

    expect(result.items[0]?.articleCount).toBe(0);
  });

  it("keeps total independent of limit and returns empty pages past the end", async () => {
    seedCustomer({ customerCode: "0001", folderPath: "/customers/one" });
    seedCustomer({ customerCode: "0002", folderPath: "/customers/two" });
    seedCustomer({ customerCode: "0003", folderPath: "/customers/three" });

    const one = await call(listCustomers, { limit: 1 });
    const pastEnd = await call(listCustomers, { limit: 2, offset: 10 });

    expect(one.items).toHaveLength(1);
    expect(one.total).toBe(3);
    expect(pastEnd.items).toEqual([]);
    expect(pastEnd.total).toBe(3);
  });
});

describe("getCustomer", () => {
  it("returns null for a missing customer", async () => {
    await expect(
      call(getCustomer, { folderPath: "/customers/missing" })
    ).resolves.toBeNull();
  });

  it("returns the typed metadata and numeric timestamps", async () => {
    seedCustomer({ metadata: metadataWith(4) });

    const customer = await call(getCustomer, {
      folderPath: path.resolve("/customers/customer-0001"),
    });

    expect(customer).toMatchObject({
      articleCount: 4,
      customerCode: CUSTOMER_CODE,
      folderName: FOLDER_NAME,
      name: "Acme Srl",
      status: "ok",
    });
    expect(customer?.metadataJson).toEqual(metadataWith(4));
    expect(typeof customer?.createdAt).toBe("number");
    expect(typeof customer?.updatedAt).toBe("number");
  });

  it("normalises legacy metadata to null without throwing", async () => {
    seedCustomer({
      metadata: { articles: 2 } as unknown as CustomerCacheMetadata,
    });

    const customer = await call(getCustomer, {
      folderPath: path.resolve("/customers/customer-0001"),
    });

    expect(customer?.metadataJson).toBeNull();
    expect(customer?.articleCount).toBe(0);
  });
});

describe("scanCustomers", () => {
  it("reports an empty result when no root is configured", async () => {
    preferencesState.folders.articlesDirectory = null;

    await expect(call(scanCustomers, {})).resolves.toEqual({
      created: 0,
      issues: [],
      removed: 0,
      root: null,
      scanned: 0,
      unchanged: 0,
      updated: 0,
    });
  });

  it("creates a row and reports the same folder unchanged on the next run", async () => {
    const folderPath = path.join(articlesDirectory, FOLDER_NAME);

    await writeCustomerConfig(folderPath);

    const first = await call(scanCustomers, {});

    expect(first).toMatchObject({
      created: 1,
      removed: 0,
      root: path.resolve(articlesDirectory),
      scanned: 1,
      unchanged: 0,
      updated: 0,
    });

    const customer = await call(getCustomer, { folderPath });

    expect(customer).toMatchObject({
      articleCount: 0,
      customerCode: CUSTOMER_CODE,
      name: "Acme",
      status: "ok",
    });

    const second = await call(scanCustomers, {});

    expect(second).toMatchObject({
      created: 0,
      removed: 0,
      scanned: 1,
      unchanged: 1,
      updated: 0,
    });
  });

  it("rethrows unexpected errors as-is", async () => {
    // The mock database is intentionally missing, so the handler fails before
    // the scanner runs and `mapCustomerError` must not hide the real error.
    state.db = undefined;

    await expect(call(scanCustomers, {})).rejects.toThrow(
      "Database has not been initialised"
    );
  });
});

describe("createCustomer", () => {
  it("writes the config file and returns the cache row", async () => {
    const created = await createDefault();

    expect(created).toMatchObject({
      articleCount: 0,
      customerCode: CUSTOMER_CODE,
      folderName: FOLDER_NAME,
      folderPath: path.join(articlesDirectory, FOLDER_NAME),
      name: "Acme",
      status: "ok",
    });
    expect(created.metadataJson).toEqual(metadataWith(0));

    const raw = await fs.readFile(
      path.join(created.folderPath, CONFIG_FILE),
      "utf8"
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    expect(parsed.customerName).toBe("Acme");
    expect(parsed).not.toHaveProperty("name");

    const listed = await call(listCustomers, {});

    expect(listed.items[0]?.articleCount).toBe(0);
  });

  it("maps a taken customer code to CONFLICT", async () => {
    await createDefault({ customerCode: CUSTOMER_CODE });

    await expect(
      createDefault({ customerCode: CUSTOMER_CODE })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("updateCustomer", () => {
  it("persists a name change to the file and the cache row", async () => {
    const created = await createDefault();

    const updated = await call(updateCustomer, {
      folderPath: created.folderPath,
      name: "Beta",
    });

    expect(updated.name).toBe("Beta");

    const config = JSON.parse(
      await fs.readFile(path.join(created.folderPath, CONFIG_FILE), "utf8")
    ) as Record<string, unknown>;

    expect(config.customerName).toBe("Beta");
  });

  it("allows an article key change when there are no articles", async () => {
    const created = await createDefault();

    const updated = await call(updateCustomer, {
      article: { ...ARTICLE, key: "NEW-{NUM:0000}" },
      folderPath: created.folderPath,
    });

    expect(updated.metadataJson).toMatchObject({
      article: { key: "NEW-{NUM:0000}" },
      articleCount: 0,
    });
  });

  it("maps a locked article key to CONFLICT", async () => {
    const created = await createDefault();

    await addValidArticle(created.folderPath, created.customerCode);

    await expect(
      call(updateCustomer, {
        article: { ...ARTICLE, key: "NEW-{NUM:0000}" },
        folderPath: created.folderPath,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("maps a missing customer folder to NOT_FOUND", async () => {
    await expect(
      call(updateCustomer, {
        folderPath: path.join(articlesDirectory, "customer-9999"),
        name: "Nobody",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maps a folder outside the articles directory to BAD_REQUEST", async () => {
    await expect(
      call(updateCustomer, {
        folderPath: path.join(tempDir, "elsewhere"),
        name: "Outside",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("removeCustomer", () => {
  it("moves a customer without articles to the trash", async () => {
    const created = await createDefault();

    await expect(
      call(removeCustomer, { folderPath: created.folderPath })
    ).resolves.toBe(created.folderPath);
    await expect(pathExists(created.folderPath)).resolves.toBe(false);
    await expect(
      pathExists(path.join(trashDirectory, FOLDER_NAME))
    ).resolves.toBe(true);
    await expect(
      call(getCustomer, { folderPath: created.folderPath })
    ).resolves.toBeNull();
  });

  it("maps a customer with articles to CONFLICT", async () => {
    const created = await createDefault();

    await addValidArticle(created.folderPath, created.customerCode);

    await expect(
      call(removeCustomer, { folderPath: created.folderPath })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(pathExists(created.folderPath)).resolves.toBe(true);
  });

  it("maps an unconfigured root to PRECONDITION_FAILED", async () => {
    preferencesState.folders.articlesDirectory = null;

    await expect(
      call(removeCustomer, {
        folderPath: path.join(articlesDirectory, FOLDER_NAME),
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("maps an unconfigured trash directory to PRECONDITION_FAILED", async () => {
    const created = await createDefault();

    preferencesState.folders.trashDirectory = null;

    await expect(
      call(removeCustomer, { folderPath: created.folderPath })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(pathExists(created.folderPath)).resolves.toBe(true);
  });
});

interface ErrorMappingCase {
  readonly expectedCode: string;
  readonly label: string;
  readonly prepare: () =>
    | (() => Promise<unknown>)
    | Promise<() => Promise<unknown>>;
  readonly skipOnWindows?: boolean;
}

const ERROR_MAPPING_CASES: readonly ErrorMappingCase[] = [
  {
    expectedCode: "PRECONDITION_FAILED",
    label: "createCustomer with an unconfigured root",
    prepare: () => {
      preferencesState.folders.articlesDirectory = null;

      return () => createDefault();
    },
  },
  {
    expectedCode: "PRECONDITION_FAILED",
    label: "updateCustomer with an unconfigured root",
    prepare: () => {
      preferencesState.folders.articlesDirectory = null;

      return () =>
        call(updateCustomer, {
          folderPath: path.join(articlesDirectory, FOLDER_NAME),
          name: "Beta",
        });
    },
  },
  {
    expectedCode: "PRECONDITION_FAILED",
    label: "removeCustomer with an unconfigured root",
    prepare: () => {
      preferencesState.folders.articlesDirectory = null;

      return () =>
        call(removeCustomer, {
          folderPath: path.join(articlesDirectory, FOLDER_NAME),
        });
    },
  },
  {
    expectedCode: "PRECONDITION_FAILED",
    label: "createCustomer with a root that is a regular file",
    prepare: async () => {
      const rootFile = path.join(tempDir, "root-file");

      await fs.writeFile(rootFile, "not a directory");
      preferencesState.folders.articlesDirectory = rootFile;

      return () => createDefault();
    },
  },
  {
    expectedCode: "PRECONDITION_FAILED",
    label: "updateCustomer with a root that is a regular file",
    prepare: async () => {
      const rootFile = path.join(tempDir, "root-file");

      await fs.writeFile(rootFile, "not a directory");
      preferencesState.folders.articlesDirectory = rootFile;

      return () =>
        call(updateCustomer, {
          folderPath: path.join(rootFile, FOLDER_NAME),
          name: "Beta",
        });
    },
  },
  {
    expectedCode: "PRECONDITION_FAILED",
    label: "removeCustomer with a root that is a regular file",
    prepare: async () => {
      const rootFile = path.join(tempDir, "root-file");

      await fs.writeFile(rootFile, "not a directory");
      preferencesState.folders.articlesDirectory = rootFile;

      return () =>
        call(removeCustomer, {
          folderPath: path.join(rootFile, FOLDER_NAME),
        });
    },
  },
  {
    expectedCode: "PRECONDITION_FAILED",
    label: "createCustomer with a symlinked root",
    prepare: async () => {
      const rootLink = path.join(tempDir, "root-link");

      await fs.symlink(articlesDirectory, rootLink, "dir");
      preferencesState.folders.articlesDirectory = rootLink;

      return () => createDefault();
    },
    skipOnWindows: true,
  },
  {
    expectedCode: "PRECONDITION_FAILED",
    label: "updateCustomer with a symlinked root",
    prepare: async () => {
      const rootLink = path.join(tempDir, "root-link");

      await fs.symlink(articlesDirectory, rootLink, "dir");
      preferencesState.folders.articlesDirectory = rootLink;

      return () =>
        call(updateCustomer, {
          folderPath: path.join(rootLink, FOLDER_NAME),
          name: "Beta",
        });
    },
    skipOnWindows: true,
  },
  {
    expectedCode: "PRECONDITION_FAILED",
    label: "removeCustomer with a symlinked root",
    prepare: async () => {
      const rootLink = path.join(tempDir, "root-link");

      await fs.symlink(articlesDirectory, rootLink, "dir");
      preferencesState.folders.articlesDirectory = rootLink;

      return () =>
        call(removeCustomer, {
          folderPath: path.join(rootLink, FOLDER_NAME),
        });
    },
    skipOnWindows: true,
  },
  {
    expectedCode: "PRECONDITION_FAILED",
    label: "removeCustomer with an unconfigured trash directory",
    prepare: async () => {
      const created = await createDefault();

      preferencesState.folders.trashDirectory = null;

      return () => call(removeCustomer, { folderPath: created.folderPath });
    },
  },
  {
    expectedCode: "PRECONDITION_FAILED",
    label: "removeCustomer with a trash path that is a regular file",
    prepare: async () => {
      const created = await createDefault();
      const trashFile = path.join(tempDir, "trash-file");

      await fs.writeFile(trashFile, "not a directory");
      preferencesState.folders.trashDirectory = trashFile;

      return () => call(removeCustomer, { folderPath: created.folderPath });
    },
  },
  {
    expectedCode: "BAD_REQUEST",
    label: "updateCustomer with a symlinked customer folder",
    prepare: async () => {
      const target = path.join(tempDir, "symlink-target");
      const folderPath = path.join(articlesDirectory, FOLDER_NAME);

      await fs.mkdir(target);
      await fs.symlink(target, folderPath, "dir");

      return () => call(updateCustomer, { folderPath, name: "Beta" });
    },
    skipOnWindows: true,
  },
  {
    expectedCode: "BAD_REQUEST",
    label: "removeCustomer with a symlinked customer folder",
    prepare: async () => {
      const target = path.join(tempDir, "symlink-target");
      const folderPath = path.join(articlesDirectory, FOLDER_NAME);

      await fs.mkdir(target);
      await fs.symlink(target, folderPath, "dir");

      return () => call(removeCustomer, { folderPath });
    },
    skipOnWindows: true,
  },
  {
    expectedCode: "BAD_REQUEST",
    label: "updateCustomer with a customer path that is a regular file",
    prepare: async () => {
      const folderPath = path.join(articlesDirectory, FOLDER_NAME);

      await fs.writeFile(folderPath, "not a directory");

      return () => call(updateCustomer, { folderPath, name: "Beta" });
    },
  },
  {
    expectedCode: "BAD_REQUEST",
    label: "removeCustomer with a customer path that is a regular file",
    prepare: async () => {
      const folderPath = path.join(articlesDirectory, FOLDER_NAME);

      await fs.writeFile(folderPath, "not a directory");

      return () => call(removeCustomer, { folderPath });
    },
  },
  {
    expectedCode: "BAD_REQUEST",
    label: "updateCustomer when the config is missing but articles exist",
    prepare: async () => {
      const folderPath = path.join(articlesDirectory, FOLDER_NAME);

      await fs.mkdir(folderPath);
      await addValidArticle(folderPath, CUSTOMER_CODE);

      return () => call(updateCustomer, { folderPath, name: "Beta" });
    },
  },
  {
    expectedCode: "BAD_REQUEST",
    label: "updateCustomer with an unsupported config schemaVersion",
    prepare: async () => {
      const folderPath = path.join(articlesDirectory, FOLDER_NAME);

      await fs.mkdir(folderPath);
      await fs.writeFile(
        path.join(folderPath, CONFIG_FILE),
        JSON.stringify({ schemaVersion: 2 })
      );

      return () => call(updateCustomer, { folderPath, name: "Beta" });
    },
  },
  {
    expectedCode: "CONFLICT",
    label: "createCustomer with an already taken code",
    prepare: async () => {
      await createDefault({ customerCode: CUSTOMER_CODE });

      return () => createDefault({ customerCode: CUSTOMER_CODE });
    },
  },
  {
    expectedCode: "CONFLICT",
    label: "removeCustomer when a valid article exists",
    prepare: async () => {
      const created = await createDefault();

      await addValidArticle(created.folderPath, created.customerCode);

      return () => call(removeCustomer, { folderPath: created.folderPath });
    },
  },
  {
    expectedCode: "CONFLICT",
    label: "updateCustomer changing the article key while articles exist",
    prepare: async () => {
      const created = await createDefault();

      await addValidArticle(created.folderPath, created.customerCode);

      return () =>
        call(updateCustomer, {
          article: { ...ARTICLE, key: "NEW-{NUM:0000}" },
          folderPath: created.folderPath,
        });
    },
  },
];

const ACTIVE_ERROR_MAPPING_CASES = ERROR_MAPPING_CASES.filter(
  (testCase) => !(testCase.skipOnWindows && process.platform === "win32")
);

describe("customer error mapping", () => {
  it.each(ACTIVE_ERROR_MAPPING_CASES)(
    "maps $label to $expectedCode",
    async ({ expectedCode, prepare }) => {
      const invoke = await prepare();

      await expect(invoke()).rejects.toMatchObject({ code: expectedCode });
    }
  );
});

const CAN_TEST_FILE_PERMISSIONS =
  process.platform !== "win32" &&
  typeof process.getuid === "function" &&
  process.getuid() !== 0;

describe("unmapped I/O failures", () => {
  it.skipIf(!CAN_TEST_FILE_PERMISSIONS)(
    "keeps READ_FAILED as a CustomerServiceError instead of an oRPC error",
    async () => {
      const created = await createDefault();

      try {
        await fs.chmod(created.folderPath, 0o000);

        const error = await call(updateCustomer, {
          folderPath: created.folderPath,
          name: "Beta",
        }).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(CustomerServiceError);
        expect(error).not.toBeInstanceOf(ORPCError);
        expect((error as CustomerServiceError).code).toBe("READ_FAILED");
      } finally {
        await fs.chmod(created.folderPath, 0o755);
      }
    }
  );
});

describe("clearCustomers", () => {
  it("returns zero when the cache is already empty", async () => {
    await expect(call(clearCustomers, undefined)).resolves.toBe(0);
  });

  it("clears only the cache and leaves the filesystem untouched", async () => {
    seedCustomer({ customerCode: "0001", folderPath: "/customers/one" });
    seedCustomer({ customerCode: "0002", folderPath: "/customers/two" });

    const marker = path.join(articlesDirectory, "keep.txt");

    await fs.writeFile(marker, "keep");

    await expect(call(clearCustomers, undefined)).resolves.toBe(2);
    await expect(call(listCustomers, {})).resolves.toEqual({
      items: [],
      total: 0,
    });
    await expect(fs.readFile(marker, "utf8")).resolves.toBe("keep");
  });
});
