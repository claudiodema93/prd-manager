// @vitest-environment node
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CUSTOMER_CONFIG_BYTES } from "@/customers/config";
import { MAX_ARTICLE_DATA_BYTES } from "@/customers/folder";
import { scanCustomers } from "@/customers/scan";
import {
  type CustomerDatabase,
  getCustomerRow,
  listCustomerRows,
  upsertCustomerRow,
} from "@/customers/store";
import type {
  CustomerCacheMetadata,
  CustomerScanResult,
} from "@/customers/types";
import { customers } from "@/db/schema";

/**
 * Simulates a folder that disappears between the directory listing and the
 * per-entry `lstat`, a race that cannot be produced deterministically on a
 * healthy filesystem.
 */
const scanControl = vi.hoisted(() => ({ missingPath: null as string | null }));

vi.mock("@/customers/folder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/customers/folder")>();

  return {
    ...actual,
    lstatIfExists: (filePath: string) => {
      if (
        scanControl.missingPath !== null &&
        filePath === scanControl.missingPath
      ) {
        return Promise.resolve(undefined);
      }

      return actual.lstatIfExists(filePath);
    },
  };
});

const schema = { customers };
type TestDatabase = ReturnType<typeof drizzle<typeof schema>>;

const CONFIG_FILE = "customer_data.json";
const ARTICLE_FILE = "article_data.json";
const TRUNCATION_MESSAGE_PATTERN = /only the first 199/u;

/**
 * chmod-based permission checks are meaningless on Windows and when the test
 * process runs as root (which bypasses the filesystem permission bits).
 */
const canRestrictPermissions =
  process.platform !== "win32" &&
  typeof process.getuid === "function" &&
  process.getuid() !== 0;

function validConfig(name = "Acme Srl"): Record<string, unknown> {
  return {
    article: {
      key: "{CODE}[_EVO{EVO:00}]",
      parameters: {
        CODE: { required: true, type: "text" },
        EVO: { default: "0", required: true, type: "number" },
      },
      schemaVersion: 1,
    },
    customerName: name,
    revision: {
      key: "REV_{REV}",
      parameters: {
        MATERIAL: { required: false, type: "text" },
        REV: { default: "0", required: true, type: "number" },
      },
      schemaVersion: 1,
    },
    schemaVersion: 1,
  };
}

/** The legacy shape that duplicates the section version at the top level. */
function legacyConfig(name = "Legacy Srl"): Record<string, unknown> {
  const config = validConfig(name);
  const revision = Object.fromEntries(
    Object.entries(config.revision as Record<string, unknown>).filter(
      ([key]) => key !== "schemaVersion"
    )
  );

  config.revision = revision;
  config.revisionSchemaVersion = 1;

  return config;
}

function emptyMetadata(): CustomerCacheMetadata {
  return { article: null, articleCount: 0, issues: [], revision: null };
}

function issueCodes(result: CustomerScanResult): string[] {
  return result.issues.map((issue) => issue.code);
}

let sqlite: Database.Database;
let db: CustomerDatabase;
let root: string;
let tempDirs: string[];

async function makeTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));

  tempDirs.push(directory);

  return directory;
}

beforeEach(async () => {
  scanControl.missingPath = null;
  sqlite = new Database(":memory:");
  const database: TestDatabase = drizzle({ client: sqlite, schema });

  migrate(database, {
    migrationsFolder: path.resolve(import.meta.dirname, "../../../drizzle"),
  });

  db = database;
  tempDirs = [];
  root = await makeTempDir("customer-scan-");
});

afterEach(async () => {
  sqlite.close();

  await Promise.all(
    tempDirs.map((directory) => rm(directory, { force: true, recursive: true }))
  );

  tempDirs = [];
});

async function createCustomerFolder(
  name: string,
  config: unknown = validConfig()
): Promise<string> {
  const folderPath = path.join(root, name);

  await mkdir(folderPath, { recursive: true });
  await writeFile(
    path.join(folderPath, CONFIG_FILE),
    typeof config === "string" ? config : JSON.stringify(config)
  );

  return folderPath;
}

async function writeArticle(
  customerFolderPath: string,
  name: string,
  value: unknown
): Promise<string> {
  const articlePath = path.join(customerFolderPath, name);

  await mkdir(articlePath, { recursive: true });
  await writeFile(
    path.join(articlePath, ARTICLE_FILE),
    typeof value === "string" ? value : JSON.stringify(value)
  );

  return articlePath;
}

function insertRow(folderPath: string, folderName = "customer-0002"): void {
  upsertCustomerRow(db, {
    articleSchemaVersion: null,
    customerCode: folderName.slice("customer-".length),
    folderMtimeMs: 1,
    folderName,
    folderPath,
    issues: [],
    metadata: emptyMetadata(),
    name: null,
    revisionSchemaVersion: null,
    schemaVersion: null,
    status: "ok",
  });
}

describe("scanCustomers", () => {
  it("returns zeroed counts and leaves the cache alone when the root is not configured", async () => {
    const folderPath = path.join(root, "customer-0001");

    insertRow(folderPath);

    const result = await scanCustomers({ db, rootDirectory: null });

    expect(result).toEqual({
      created: 0,
      issues: [],
      removed: 0,
      root: null,
      scanned: 0,
      unchanged: 0,
      updated: 0,
    });
    expect(listCustomerRows(db)).toHaveLength(1);
  });

  it("reports a missing root without deleting existing rows", async () => {
    const missingRoot = path.join(root, "missing-root");
    const folderPath = path.join(missingRoot, "customer-0001");

    insertRow(folderPath, "customer-0001");

    const result = await scanCustomers({ db, rootDirectory: missingRoot });

    expect(result).toMatchObject({
      created: 0,
      removed: 0,
      root: missingRoot,
      scanned: 0,
      unchanged: 0,
      updated: 0,
    });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: "ROOT_MISSING",
      path: missingRoot,
      severity: "error",
    });
    expect(getCustomerRow(db, folderPath)).not.toBeNull();
  });

  it("reports a root that is not a directory", async () => {
    const fileRoot = path.join(root, "not-a-directory");

    await writeFile(fileRoot, "hello");

    const result = await scanCustomers({ db, rootDirectory: fileRoot });

    expect(result.issues[0]).toMatchObject({
      code: "ROOT_NOT_DIRECTORY",
      path: fileRoot,
      severity: "error",
    });
  });

  it("rejects a root containing a NUL character", async () => {
    const result = await scanCustomers({
      db,
      rootDirectory: `${root}\0invalid`,
    });

    expect(result.issues[0]).toMatchObject({
      code: "ROOT_UNREADABLE",
      severity: "error",
    });
  });

  it.skipIf(process.platform === "win32")(
    "reports a symbolic-link root without following it",
    async () => {
      const target = await makeTempDir("customer-scan-root-target-");
      const linkRoot = path.join(root, "root-link");

      await symlink(target, linkRoot, "dir");

      const result = await scanCustomers({ db, rootDirectory: linkRoot });

      expect(result.issues[0]).toMatchObject({
        code: "ROOT_SYMLINK",
        path: linkRoot,
        severity: "error",
      });
    }
  );

  it("creates a row for a valid customer with a clean config", async () => {
    const folderPath = await createCustomerFolder("customer-0001");

    const result = await scanCustomers({ db, rootDirectory: root });

    expect(result).toMatchObject({
      created: 1,
      removed: 0,
      root,
      scanned: 1,
      unchanged: 0,
      updated: 0,
    });
    expect(result.issues).toEqual([]);

    const row = getCustomerRow(db, folderPath);

    expect(row).toMatchObject({
      articleSchemaVersion: 1,
      customerCode: "0001",
      folderName: "customer-0001",
      folderPath,
      name: "Acme Srl",
      revisionSchemaVersion: 1,
      schemaVersion: 1,
      status: "ok",
    });
    expect(row?.metadataJson).toEqual({
      article: validConfig().article,
      articleCount: 0,
      issues: [],
      revision: validConfig().revision,
    });
  });

  it("accepts a legacy config with a top-level revisionSchemaVersion", async () => {
    const folderPath = await createCustomerFolder(
      "customer-0001",
      legacyConfig("Legacy Srl")
    );

    const result = await scanCustomers({ db, rootDirectory: root });

    expect(result).toMatchObject({ created: 1, scanned: 1 });
    expect(result.issues).toEqual([]);
    expect(getCustomerRow(db, folderPath)).toMatchObject({
      articleSchemaVersion: 1,
      name: "Legacy Srl",
      revisionSchemaVersion: 1,
      status: "ok",
    });
  });

  it("counts valid articles and warns about missing or invalid article_data.json", async () => {
    const folderPath = await createCustomerFolder("customer-0001");

    await writeArticle(folderPath, "a-valid", {
      customer: "0001",
      schemaVersion: 1,
    });
    await mkdir(path.join(folderPath, "b-missing"), { recursive: true });
    await writeArticle(folderPath, "c-invalid", "{not json");

    const result = await scanCustomers({ db, rootDirectory: root });
    const row = getCustomerRow(db, folderPath);

    expect(result).toMatchObject({ created: 1, scanned: 1 });
    expect(row).toMatchObject({ status: "warning" });
    expect(row?.metadataJson).toMatchObject({
      articleCount: 1,
      issues: [
        expect.objectContaining({ code: "ARTICLE_INVALID" }),
        expect.objectContaining({ code: "ARTICLE_INVALID" }),
      ],
    });
  });

  it.skipIf(process.platform === "win32")(
    "warns about a symlinked article folder without following it",
    async () => {
      const folderPath = await createCustomerFolder("customer-0001");
      const target = await makeTempDir("customer-scan-article-target-");

      await writeFile(
        path.join(target, ARTICLE_FILE),
        JSON.stringify({ customer: "0001", schemaVersion: 1 })
      );
      await symlink(target, path.join(folderPath, "linked"), "dir");

      const result = await scanCustomers({ db, rootDirectory: root });
      const row = getCustomerRow(db, folderPath);

      expect(row).toMatchObject({ status: "warning" });
      expect(row?.metadataJson).toMatchObject({
        articleCount: 0,
        issues: [
          expect.objectContaining({
            code: "ARTICLE_SYMLINK",
            severity: "warning",
          }),
        ],
      });
      expect(issueCodes(result)).toContain("ARTICLE_SYMLINK");
    }
  );

  it("reports a missing customer_data.json but still counts articles", async () => {
    const folderPath = path.join(root, "customer-0001");

    await mkdir(folderPath, { recursive: true });
    await writeArticle(folderPath, "a-valid", {
      customer: "0001",
      schemaVersion: 1,
    });

    const result = await scanCustomers({ db, rootDirectory: root });
    const row = getCustomerRow(db, folderPath);

    expect(result).toMatchObject({ created: 1, scanned: 1 });
    expect(row).toMatchObject({
      articleSchemaVersion: null,
      name: null,
      revisionSchemaVersion: null,
      schemaVersion: null,
      status: "error",
    });
    expect(row?.metadataJson).toMatchObject({
      articleCount: 1,
      issues: [expect.objectContaining({ code: "CONFIG_MISSING" })],
    });
    expect(issueCodes(result)).toContain("CONFIG_MISSING");
  });

  it("distinguishes unreadable JSON from an invalid config shape", async () => {
    const unreadable = await createCustomerFolder("customer-0001", "{not json");
    const invalid = await createCustomerFolder("customer-0002", {
      schemaVersion: 1,
    });

    await writeArticle(unreadable, "a-valid", {
      customer: "0001",
      schemaVersion: 1,
    });
    await writeArticle(invalid, "a-valid", {
      customer: "0002",
      schemaVersion: 1,
    });

    const result = await scanCustomers({ db, rootDirectory: root });
    const unreadableRow = getCustomerRow(db, unreadable);
    const invalidRow = getCustomerRow(db, invalid);

    expect(result).toMatchObject({ created: 2, scanned: 2 });
    expect(unreadableRow).toMatchObject({ name: null, status: "error" });
    expect(unreadableRow?.metadataJson).toMatchObject({
      articleCount: 1,
      issues: [expect.objectContaining({ code: "CONFIG_INVALID_JSON" })],
    });
    expect(invalidRow?.metadataJson).toMatchObject({
      articleCount: 1,
      issues: [expect.objectContaining({ code: "CONFIG_INVALID" })],
    });
  });

  it.skipIf(process.platform === "win32")(
    "reports a symlinked customer folder without following it",
    async () => {
      const target = await makeTempDir("customer-scan-folder-target-");
      const linkPath = path.join(root, "customer-0001");

      await writeFile(
        path.join(target, CONFIG_FILE),
        JSON.stringify(validConfig("Linked Srl"))
      );
      await mkdir(path.join(target, "a-article"), { recursive: true });
      await writeFile(
        path.join(target, "a-article", ARTICLE_FILE),
        JSON.stringify({ customer: "0001", schemaVersion: 1 })
      );
      await symlink(target, linkPath, "dir");

      const result = await scanCustomers({ db, rootDirectory: root });
      const row = getCustomerRow(db, linkPath);

      expect(result).toMatchObject({ created: 1, scanned: 1 });
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: "FOLDER_SYMLINK",
          path: linkPath,
          severity: "error",
        })
      );
      expect(row).toMatchObject({
        customerCode: "0001",
        name: null,
        status: "error",
      });
      expect(row?.metadataJson).toMatchObject({ articleCount: 0 });
    }
  );

  it("does not churn unchanged rows and updates an edited config", async () => {
    const folderPath = await createCustomerFolder("customer-0001");

    const first = await scanCustomers({ db, rootDirectory: root });

    expect(first).toMatchObject({ created: 1, scanned: 1 });
    const firstRow = getCustomerRow(db, folderPath);

    const second = await scanCustomers({ db, rootDirectory: root });

    expect(second).toMatchObject({
      created: 0,
      removed: 0,
      scanned: 1,
      unchanged: 1,
      updated: 0,
    });
    expect(getCustomerRow(db, folderPath)?.updatedAt).toBe(firstRow?.updatedAt);

    await writeFile(
      path.join(folderPath, CONFIG_FILE),
      JSON.stringify(validConfig("Updated Srl"))
    );

    const third = await scanCustomers({ db, rootDirectory: root });

    expect(third).toMatchObject({
      created: 0,
      removed: 0,
      scanned: 1,
      unchanged: 0,
      updated: 1,
    });
    expect(getCustomerRow(db, folderPath)?.name).toBe("Updated Srl");
  });

  it("removes stale rows under the root and rows from a previous root", async () => {
    const folderPath = await createCustomerFolder("customer-0001");
    const outsideDir = await makeTempDir("customer-scan-outside-");
    const outsidePath = path.join(outsideDir, "customer-0002");

    await scanCustomers({ db, rootDirectory: root });
    insertRow(outsidePath);

    await rm(folderPath, { force: true, recursive: true });

    const result = await scanCustomers({ db, rootDirectory: root });

    expect(result).toMatchObject({
      created: 0,
      removed: 2,
      scanned: 0,
      unchanged: 0,
      updated: 0,
    });
    expect(getCustomerRow(db, folderPath)).toBeNull();
    expect(getCustomerRow(db, outsidePath)).toBeNull();
  });

  it("aborts without touching the cache when the root exceeds its entry budget", async () => {
    await createCustomerFolder("customer-0001");
    await createCustomerFolder("customer-0002");
    const firstPath = path.join(root, "customer-0001");

    insertRow(firstPath, "customer-0001");

    const result = await scanCustomers({
      db,
      maxRootEntries: 1,
      rootDirectory: root,
    });

    expect(result).toMatchObject({
      created: 0,
      removed: 0,
      scanned: 0,
      unchanged: 0,
      updated: 0,
    });
    expect(result.issues[0]).toMatchObject({
      code: "ROOT_UNREADABLE",
      severity: "error",
    });
    expect(getCustomerRow(db, firstPath)).not.toBeNull();
  });

  it("removes a row whose folder vanished between the listing and the inspection", async () => {
    const folderPath = await createCustomerFolder("customer-0001");

    insertRow(folderPath, "customer-0001");
    scanControl.missingPath = folderPath;

    try {
      const result = await scanCustomers({ db, rootDirectory: root });

      expect(result).toMatchObject({ removed: 1, scanned: 0 });
      expect(getCustomerRow(db, folderPath)).toBeNull();
    } finally {
      scanControl.missingPath = null;
    }
  });

  it("ignores hidden and non-customer entries but flags a customer-named file", async () => {
    await mkdir(path.join(root, ".hidden"));
    await mkdir(path.join(root, "documents"));
    await mkdir(path.join(root, "customer-12"));
    const filePath = path.join(root, "customer-0003");

    await writeFile(filePath, "regular file");

    const result = await scanCustomers({ db, rootDirectory: root });

    expect(result).toMatchObject({
      created: 1,
      removed: 0,
      scanned: 1,
      unchanged: 0,
      updated: 0,
    });
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]).toMatchObject({
      code: "FOLDER_NOT_DIRECTORY",
      path: filePath,
      severity: "error",
    });
    expect(result.issues[1]).toMatchObject({
      code: "ENTRY_UNEXPECTED",
      path: path.join(root, "customer-12"),
      severity: "warning",
    });

    const row = getCustomerRow(db, filePath);

    expect(row).toMatchObject({ name: null, status: "error" });
  });

  it("updates a row written with an old metadata shape", async () => {
    const folderPath = await createCustomerFolder("customer-0001");

    upsertCustomerRow(db, {
      articleSchemaVersion: null,
      customerCode: "0001",
      folderMtimeMs: 1,
      folderName: "customer-0001",
      folderPath,
      issues: [],
      metadata: { articles: 12 } as unknown as CustomerCacheMetadata,
      name: null,
      revisionSchemaVersion: null,
      schemaVersion: null,
      status: "ok",
    });

    const result = await scanCustomers({ db, rootDirectory: root });
    const row = getCustomerRow(db, folderPath);

    expect(result).toMatchObject({ created: 0, scanned: 1, updated: 1 });
    expect(row).toMatchObject({ name: "Acme Srl", status: "ok" });
    expect(row?.metadataJson).toMatchObject({ articleCount: 0 });
  });

  it("caps scan issues at 200 and keeps the order deterministic", async () => {
    const names = Array.from(
      { length: 205 },
      (_, index) => `customer-invalid-${String(index).padStart(3, "0")}`
    );

    await Promise.all(names.map((name) => mkdir(path.join(root, name))));

    const result = await scanCustomers({ db, rootDirectory: root });

    expect(result.issues).toHaveLength(200);
    expect(
      result.issues
        .slice(0, 199)
        .map((issue) => path.basename(issue.path ?? ""))
    ).toEqual(names.slice(0, 199));
    expect(result.issues[199]).toMatchObject({
      code: "ENTRY_UNEXPECTED",
      severity: "warning",
    });
    expect(result.issues[199]?.message).toMatch(TRUNCATION_MESSAGE_PATTERN);
  });

  it.skipIf(!canRestrictPermissions)(
    "keeps scanning when one customer folder cannot be read",
    async () => {
      const good = await createCustomerFolder("customer-0001");
      const bad = await createCustomerFolder("customer-0002");

      await writeArticle(good, "a-valid", {
        customer: "0001",
        schemaVersion: 1,
      });
      await writeArticle(bad, "a-valid", {
        customer: "0002",
        schemaVersion: 1,
      });

      await chmod(bad, 0o000);

      try {
        const result = await scanCustomers({ db, rootDirectory: root });

        expect(result).toMatchObject({ scanned: 2 });
        expect(getCustomerRow(db, good)).toMatchObject({
          name: "Acme Srl",
          status: "ok",
        });

        const badRow = getCustomerRow(db, bad);

        expect(badRow).not.toBeNull();
        expect(badRow).toMatchObject({ status: "error" });
        expect(
          result.issues.some(
            (issue) =>
              issue.path?.startsWith(bad) === true &&
              (issue.severity === "error" || issue.severity === "warning")
          )
        ).toBe(true);
      } finally {
        await chmod(bad, 0o755);
      }
    }
  );

  it.skipIf(!canRestrictPermissions)(
    "reports FOLDER_UNREADABLE per entry when the root is not searchable",
    async () => {
      await createCustomerFolder("customer-0001");
      await createCustomerFolder("customer-0002");

      await chmod(root, 0o444);

      try {
        const result = await scanCustomers({ db, rootDirectory: root });

        expect(result).toMatchObject({ scanned: 0 });
        const unreadable = result.issues.filter(
          (issue) => issue.code === "FOLDER_UNREADABLE"
        );

        expect(unreadable).toHaveLength(2);
        expect(
          unreadable.every(
            (issue) =>
              issue.severity === "error" &&
              issue.path?.startsWith(root) === true
          )
        ).toBe(true);
      } finally {
        await chmod(root, 0o755);
      }
    }
  );

  it("classifies config failures and still counts valid articles", async () => {
    const unsupported = await createCustomerFolder("customer-0001", {
      ...validConfig(),
      schemaVersion: 2,
    });
    const conflict = await createCustomerFolder("customer-0002", {
      ...validConfig(),
      articleSchemaVersion: 2,
    });
    const configTargetDir = await makeTempDir("customer-scan-config-target-");
    const configTarget = path.join(configTargetDir, CONFIG_FILE);

    await writeFile(configTarget, JSON.stringify(validConfig()));

    const symlinked = path.join(root, "customer-0003");

    await mkdir(symlinked);
    await symlink(configTarget, path.join(symlinked, CONFIG_FILE));

    const directoryConfig = path.join(root, "customer-0004");

    await mkdir(path.join(directoryConfig, CONFIG_FILE), { recursive: true });

    const oversized = path.join(root, "customer-0005");

    await mkdir(oversized);
    await writeFile(
      path.join(oversized, CONFIG_FILE),
      "x".repeat(MAX_CUSTOMER_CONFIG_BYTES + 1)
    );

    const expectations: Array<{
      articleCode: string;
      folderPath: string;
      issueCode: string;
    }> = [
      {
        articleCode: "0001",
        folderPath: unsupported,
        issueCode: "CONFIG_INVALID",
      },
      {
        articleCode: "0002",
        folderPath: conflict,
        issueCode: "CONFIG_INVALID",
      },
      {
        articleCode: "0003",
        folderPath: symlinked,
        issueCode: "CONFIG_UNREADABLE",
      },
      {
        articleCode: "0004",
        folderPath: directoryConfig,
        issueCode: "CONFIG_UNREADABLE",
      },
      {
        articleCode: "0005",
        folderPath: oversized,
        issueCode: "CONFIG_UNREADABLE",
      },
    ];

    await Promise.all(
      expectations.map((entry) =>
        writeArticle(entry.folderPath, "a-valid", {
          customer: entry.articleCode,
          schemaVersion: 1,
        })
      )
    );

    const result = await scanCustomers({ db, rootDirectory: root });

    expect(result).toMatchObject({ scanned: 5 });

    for (const entry of expectations) {
      const row = getCustomerRow(db, entry.folderPath);

      expect(row).toMatchObject({ name: null, status: "error" });
      expect(row?.metadataJson).toMatchObject({
        articleCount: 1,
        issues: expect.arrayContaining([
          expect.objectContaining({ code: entry.issueCode }),
        ]),
      });
    }
  });

  it("warns about an oversized article_data.json without counting it", async () => {
    const folderPath = await createCustomerFolder("customer-0001");
    const articlePath = path.join(folderPath, "a-large");

    await mkdir(articlePath);
    await writeFile(
      path.join(articlePath, ARTICLE_FILE),
      "x".repeat(MAX_ARTICLE_DATA_BYTES + 1)
    );

    const result = await scanCustomers({ db, rootDirectory: root });
    const row = getCustomerRow(db, folderPath);

    expect(result).toMatchObject({ created: 1, scanned: 1 });
    expect(row).toMatchObject({ status: "warning" });
    expect(row?.metadataJson).toMatchObject({
      articleCount: 0,
      issues: [
        expect.objectContaining({
          code: "ARTICLE_INVALID",
          severity: "warning",
        }),
      ],
    });
  });

  it("reconciles a config mtime change without resetting createdAt or metadata", async () => {
    const folderPath = await createCustomerFolder("customer-0001");

    await scanCustomers({ db, rootDirectory: root });

    const first = getCustomerRow(db, folderPath);

    expect(first).not.toBeNull();

    const future = new Date(Date.now() + 60_000);

    await utimes(path.join(folderPath, CONFIG_FILE), future, future);

    const second = await scanCustomers({ db, rootDirectory: root });
    const after = getCustomerRow(db, folderPath);

    expect(second).toMatchObject({
      scanned: 1,
      unchanged: 0,
      updated: 1,
    });
    expect(after?.createdAt).toBe(first?.createdAt);
    expect(after?.metadataJson).toEqual(first?.metadataJson);
    expect(after?.updatedAt).toBeGreaterThanOrEqual(first?.updatedAt ?? 0);
  });
});
