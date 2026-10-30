// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({
  appPath: "",
  isPackaged: false,
  userData: "",
}));

vi.mock("electron", () => ({
  app: {
    getAppPath: () => electronState.appPath,
    getPath: (name: string) => {
      if (name !== "userData") {
        throw new Error(`Unexpected app.getPath("${name}")`);
      }

      return electronState.userData;
    },
    get isPackaged() {
      return electronState.isPackaged;
    },
  },
}));

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TEST_DIRECTORY, "../../..");
const CACHE_APPLICATION_ID = 0x43_41_43_48;
const DATABASE_PATH_ENV = "APP_CACHE_DB_PATH";
const SKIP_INTEGRITY_CHECK_ENV = "APP_CACHE_SKIP_INTEGRITY_CHECK";

const NOT_INITIALISED_PATTERN = /not been initialised/iu;
const ABSOLUTE_PATH_PATTERN = /absolute path/iu;
const DIRECTORY_PATTERN = /points to a directory/iu;
const NOT_CACHE_DATABASE_PATTERN = /not a cache database/iu;
const FOREIGN_DATABASE_PATTERN = /does not belong to this app/iu;
const FOREIGN_APPLICATION_PATTERN = /belongs to another application/iu;
const MIGRATIONS_NOT_FOUND_PATTERN = /Drizzle migrations not found/iu;
const SYMBOLIC_LINK_PATTERN = /symbolic link/iu;

type DbModule = typeof import("@/db");
type DatabaseConnection = ReturnType<DbModule["getDatabase"]>;

let tempDir: string;
let dbModule: DbModule | undefined;

async function loadDb(): Promise<DbModule> {
  dbModule = await import("@/db");
  return dbModule;
}

function setResourcesPath(value: string | undefined): void {
  const target = process as unknown as { resourcesPath?: string };

  if (value === undefined) {
    Reflect.deleteProperty(target, "resourcesPath");
  } else {
    target.resourcesPath = value;
  }
}

function fileDatabasePath(): string {
  return path.join(tempDir, "cache.db");
}

function createDatabaseFile(
  file: string,
  setup: (connection: Database.Database) => void
): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const connection = new Database(file);

  try {
    setup(connection);
  } finally {
    connection.close();
  }
}

/**
 * Creates a valid cache database and then corrupts the freelist trunk pointer
 * in its header. quick_check reports the corruption, but the schema can still
 * be read and the tables dropped, so recovery can happen in place.
 */
function createCorruptOwnedDatabase(file: string): void {
  createDatabaseFile(file, (connection) => {
    connection.pragma(`application_id = ${CACHE_APPLICATION_ID}`);
    connection.exec("CREATE TABLE junk (value TEXT)");
    connection.prepare("INSERT INTO junk (value) VALUES (?)").run("keep me");
  });

  const contents = fs.readFileSync(file);
  contents.writeUInt32BE(9999, 32);
  fs.writeFileSync(file, contents);
}

/**
 * Creates a cache database whose user table spans many pages and then breaks a
 * non-root leaf page. quick_check detects it, but DROP TABLE cannot traverse
 * the table any more, forcing recovery down the move-aside path.
 */
function createUnresettableOwnedDatabase(file: string): void {
  createDatabaseFile(file, (connection) => {
    connection.pragma(`application_id = ${CACHE_APPLICATION_ID}`);
    connection.exec("CREATE TABLE junk (value TEXT)");
    const insert = connection.prepare("INSERT INTO junk (value) VALUES (?)");

    for (let index = 0; index < 900; index += 1) {
      insert.run(`value-${index}-${"x".repeat(120)}`);
    }
  });

  const contents = fs.readFileSync(file);
  const pageSize = contents.readUInt16BE(16);
  const pageCount = contents.readUInt32BE(28);
  const roots = new Set<number>();

  const probe = new Database(file);

  try {
    for (const row of probe
      .prepare("SELECT rootpage FROM sqlite_master")
      .all() as { rootpage: number }[]) {
      roots.add(row.rootpage);
    }
  } finally {
    probe.close();
  }

  let targetPage = 0;

  for (let page = 2; page <= pageCount; page += 1) {
    const pageType = contents[(page - 1) * pageSize];

    if (!roots.has(page) && (pageType === 0x0d || pageType === 0x0a)) {
      targetPage = page;
      break;
    }
  }

  if (targetPage === 0) {
    throw new Error("Unable to find a non-root b-tree page to corrupt");
  }

  contents[(targetPage - 1) * pageSize] = 0;
  fs.writeFileSync(file, contents);
}

function tableExists(connection: DatabaseConnection, name: string): boolean {
  return Boolean(
    connection.$client
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name)
  );
}

function corruptSiblings(directory: string): string[] {
  return fs.readdirSync(directory).filter((name) => name.includes(".corrupt-"));
}

/** Permission bits (rwx) without the file-type bits. */
function permissionBits(file: string): number {
  return fs.statSync(file).mode % 0o1000;
}

function copyMigrations(base: string): void {
  fs.cpSync(path.join(PROJECT_ROOT, "drizzle"), path.join(base, "drizzle"), {
    recursive: true,
  });
}

beforeEach(() => {
  vi.resetModules();
  dbModule = undefined;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "app-db-test-"));
  electronState.appPath = PROJECT_ROOT;
  electronState.isPackaged = false;
  electronState.userData = path.join(tempDir, "userData");
  fs.mkdirSync(electronState.userData, { recursive: true });
  Reflect.deleteProperty(process.env, DATABASE_PATH_ENV);
  Reflect.deleteProperty(process.env, SKIP_INTEGRITY_CHECK_ENV);
  setResourcesPath(undefined);
});

afterEach(() => {
  dbModule?.closeDatabase();
  dbModule = undefined;
  Reflect.deleteProperty(process.env, DATABASE_PATH_ENV);
  Reflect.deleteProperty(process.env, SKIP_INTEGRITY_CHECK_ENV);
  setResourcesPath(undefined);
  fs.rmSync(tempDir, { force: true, recursive: true });
});

describe("database lifecycle", () => {
  it("throws before init, reuses the instance, and closes safely", async () => {
    process.env[DATABASE_PATH_ENV] = ":memory:";
    const db = await loadDb();

    expect(() => db.getDatabase()).toThrow(NOT_INITIALISED_PATTERN);

    const first = db.initDatabase();

    expect(db.initDatabase()).toBe(first);
    expect(db.getDatabase()).toBe(first);

    db.closeDatabase();
    expect(() => db.closeDatabase()).not.toThrow();
    expect(() => db.getDatabase()).toThrow(NOT_INITIALISED_PATTERN);
  });

  it("uses userData/cache.db by default", async () => {
    const db = await loadDb();

    db.initDatabase();

    expect(fs.existsSync(path.join(electronState.userData, "cache.db"))).toBe(
      true
    );
  });

  it("supports an in-memory database", async () => {
    process.env[DATABASE_PATH_ENV] = ":memory:";
    const db = await loadDb();
    const connection = db.initDatabase();

    expect(connection.$client.memory).toBe(true);
    expect(connection.$client.pragma("application_id", { simple: true })).toBe(
      CACHE_APPLICATION_ID
    );
    // WAL is not available for in-memory databases, but requesting it must not
    // fail.
    expect(connection.$client.pragma("journal_mode", { simple: true })).toBe(
      "memory"
    );
  });
});

describe("database path handling", () => {
  it("rejects a relative override", async () => {
    process.env[DATABASE_PATH_ENV] = "relative/cache.db";
    const db = await loadDb();

    expect(() => db.initDatabase()).toThrow(ABSOLUTE_PATH_PATTERN);
    expect(fs.existsSync(path.resolve("relative/cache.db"))).toBe(false);
  });

  it("rejects a directory override", async () => {
    const directory = path.join(tempDir, "not-a-database");
    fs.mkdirSync(directory, { recursive: true });
    process.env[DATABASE_PATH_ENV] = directory;
    const db = await loadDb();

    expect(() => db.initDatabase()).toThrow(DIRECTORY_PATTERN);
  });

  it("treats a whitespace-only override as unset", async () => {
    process.env[DATABASE_PATH_ENV] = "   ";
    const db = await loadDb();

    db.initDatabase();

    expect(fs.existsSync(path.join(electronState.userData, "cache.db"))).toBe(
      true
    );
  });

  it("enables WAL and foreign keys for a file database", async () => {
    process.env[DATABASE_PATH_ENV] = fileDatabasePath();
    const db = await loadDb();
    const connection = db.initDatabase();

    expect(connection.$client.pragma("journal_mode", { simple: true })).toBe(
      "wal"
    );
    expect(connection.$client.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "restricts the override database without touching its parent directory",
    async () => {
      const overrideDirectory = path.join(tempDir, "override");
      fs.mkdirSync(overrideDirectory, { recursive: true });
      fs.chmodSync(overrideDirectory, 0o755);
      const file = path.join(overrideDirectory, "cache.db");
      process.env[DATABASE_PATH_ENV] = file;
      const db = await loadDb();

      db.initDatabase();

      expect(permissionBits(overrideDirectory)).toBe(0o755);
      expect(permissionBits(file)).toBe(0o600);
    }
  );
});

describe("non-destructive failure handling", () => {
  it("never touches a non-SQLite file at the override path", async () => {
    const file = path.join(tempDir, "notes.txt");
    const original = "this is definitely not a sqlite database\n";
    fs.writeFileSync(file, original);
    process.env[DATABASE_PATH_ENV] = file;
    const db = await loadDb();

    expect(() => db.initDatabase()).toThrow(NOT_CACHE_DATABASE_PATTERN);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
    expect(corruptSiblings(tempDir)).toEqual([]);
  });

  it("never touches a truncated non-SQLite file at the override path", async () => {
    const file = path.join(tempDir, "truncated.bin");
    const original = "not sqlite";
    fs.writeFileSync(file, original);
    process.env[DATABASE_PATH_ENV] = file;
    const db = await loadDb();

    expect(() => db.initDatabase()).toThrow(NOT_CACHE_DATABASE_PATTERN);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
    expect(corruptSiblings(tempDir)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "refuses a symlink at the override path",
    async () => {
      const target = path.join(tempDir, "target.txt");
      const link = path.join(tempDir, "link.db");
      fs.writeFileSync(target, "not a database");
      fs.symlinkSync(target, link);
      process.env[DATABASE_PATH_ENV] = link;
      const db = await loadDb();

      expect(() => db.initDatabase()).toThrow(SYMBOLIC_LINK_PATTERN);
      expect(fs.readFileSync(target, "utf8")).toBe("not a database");
    }
  );

  it.skipIf(process.platform === "win32")(
    "refuses a dangling symlink at the override path without creating its target",
    async () => {
      const target = path.join(tempDir, "missing-target.db");
      const link = path.join(tempDir, "dangling.db");
      fs.symlinkSync(target, link);
      process.env[DATABASE_PATH_ENV] = link;
      const db = await loadDb();

      expect(() => db.initDatabase()).toThrow(SYMBOLIC_LINK_PATTERN);
      expect(fs.existsSync(target)).toBe(false);
    }
  );

  it.skipIf(process.platform === "win32")(
    "refuses a dangling symlink at a sidecar path before opening the database",
    async () => {
      const file = path.join(tempDir, "cache.db");
      const walTarget = path.join(tempDir, "missing-wal");
      fs.symlinkSync(walTarget, `${file}-wal`);
      process.env[DATABASE_PATH_ENV] = file;
      const db = await loadDb();

      expect(() => db.initDatabase()).toThrow(SYMBOLIC_LINK_PATTERN);
      expect(fs.existsSync(file)).toBe(false);
      expect(fs.existsSync(walTarget)).toBe(false);
    }
  );

  it("refuses another Drizzle database on an override", async () => {
    const file = path.join(tempDir, "other-drizzle.db");
    createDatabaseFile(file, (connection) => {
      connection.exec("CREATE TABLE __drizzle_migrations (id INTEGER)");
      connection.exec("CREATE TABLE secrets (value TEXT)");
    });

    process.env[DATABASE_PATH_ENV] = file;
    const db = await loadDb();

    expect(() => db.initDatabase()).toThrow(FOREIGN_DATABASE_PATTERN);
  });

  it("refuses a foreign SQLite database without the sentinel", async () => {
    const file = path.join(tempDir, "other-app.db");
    createDatabaseFile(file, (connection) => {
      connection.exec("CREATE TABLE secrets (value TEXT)");
      connection
        .prepare("INSERT INTO secrets (value) VALUES (?)")
        .run("classified");
    });

    const before = fs.readFileSync(file);
    process.env[DATABASE_PATH_ENV] = file;
    const db = await loadDb();

    expect(() => db.initDatabase()).toThrow(FOREIGN_DATABASE_PATTERN);
    expect(Buffer.compare(before, fs.readFileSync(file))).toBe(0);

    const probe = new Database(file, { readonly: true });

    try {
      expect(probe.prepare("SELECT value FROM secrets").all()).toEqual([
        { value: "classified" },
      ]);
      expect(
        probe
          .prepare(
            "SELECT name FROM sqlite_master WHERE name = '__drizzle_migrations'"
          )
          .get()
      ).toBeUndefined();
    } finally {
      probe.close();
    }

    expect(corruptSiblings(tempDir)).toEqual([]);
  });

  it("refuses a SQLite database owned by another application", async () => {
    const file = path.join(tempDir, "other-app.db");
    createDatabaseFile(file, (connection) => {
      connection.pragma("application_id = 12345");
      connection.exec("CREATE TABLE secrets (value TEXT)");
    });

    process.env[DATABASE_PATH_ENV] = file;
    const db = await loadDb();

    expect(() => db.initDatabase()).toThrow(FOREIGN_APPLICATION_PATTERN);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "surfaces a non-corruption failure without modifying the file",
    async () => {
      const file = fileDatabasePath();
      createDatabaseFile(file, (connection) => {
        connection.pragma(`application_id = ${CACHE_APPLICATION_ID}`);
        connection.exec("CREATE TABLE junk (value TEXT)");
      });

      const before = fs.readFileSync(file);
      fs.chmodSync(file, 0o444);
      process.env[DATABASE_PATH_ENV] = file;
      const db = await loadDb();

      expect(() => db.initDatabase()).toThrow();
      expect(Buffer.compare(before, fs.readFileSync(file))).toBe(0);
      expect(corruptSiblings(tempDir)).toEqual([]);
    }
  );
});

describe("default cache file recovery", () => {
  it("initialises an empty default cache file", async () => {
    const file = path.join(electronState.userData, "cache.db");
    fs.writeFileSync(file, "");
    const db = await loadDb();
    const connection = db.initDatabase();

    expect(tableExists(connection, "customers")).toBe(true);
    expect(fs.readFileSync(file).subarray(0, 15).toString()).toBe(
      "SQLite format 3"
    );
  });

  it("moves a truncated default cache aside instead of deleting it", async () => {
    const file = path.join(electronState.userData, "cache.db");
    const original = "not sqlite";
    fs.writeFileSync(file, original);
    const db = await loadDb();
    const connection = db.initDatabase();

    expect(tableExists(connection, "customers")).toBe(true);

    const moved = corruptSiblings(electronState.userData);

    expect(moved).toHaveLength(1);
    expect(
      fs.readFileSync(path.join(electronState.userData, moved[0] ?? ""), "utf8")
    ).toBe(original);
  });

  it("moves a damaged default cache aside instead of deleting it", async () => {
    const file = path.join(electronState.userData, "cache.db");
    const original = "this is not a sqlite database";
    fs.writeFileSync(file, original);
    const db = await loadDb();
    const connection = db.initDatabase();

    expect(tableExists(connection, "customers")).toBe(true);
    expect(fs.readFileSync(file).subarray(0, 15).toString()).toBe(
      "SQLite format 3"
    );

    const moved = corruptSiblings(electronState.userData);

    expect(moved).toHaveLength(1);
    expect(
      fs.readFileSync(path.join(electronState.userData, moved[0] ?? ""), "utf8")
    ).toBe(original);
  });
});

describe("corruption recovery", () => {
  it("runs quick_check on an existing file and repairs it in place", async () => {
    createCorruptOwnedDatabase(fileDatabasePath());
    process.env[DATABASE_PATH_ENV] = fileDatabasePath();
    const db = await loadDb();
    const connection = db.initDatabase();

    expect(fs.existsSync(fileDatabasePath())).toBe(true);
    expect(tableExists(connection, "junk")).toBe(false);
    expect(tableExists(connection, "customers")).toBe(true);
    expect(
      connection.$client
        .prepare("SELECT COUNT(*) AS count FROM customers")
        .get()
    ).toEqual({ count: 0 });
    expect(corruptSiblings(tempDir)).toEqual([]);
  });

  it("skips quick_check in development when the env var is set", async () => {
    createCorruptOwnedDatabase(fileDatabasePath());
    process.env[DATABASE_PATH_ENV] = fileDatabasePath();
    process.env[SKIP_INTEGRITY_CHECK_ENV] = "1";
    const db = await loadDb();
    const connection = db.initDatabase();

    // With quick_check skipped, migrations run on the corrupt file and the
    // junk table is never cleared.
    expect(tableExists(connection, "junk")).toBe(true);
    expect(tableExists(connection, "customers")).toBe(true);
  });

  it("never skips quick_check in a packaged build", async () => {
    electronState.isPackaged = true;
    createCorruptOwnedDatabase(fileDatabasePath());
    process.env[DATABASE_PATH_ENV] = fileDatabasePath();
    process.env[SKIP_INTEGRITY_CHECK_ENV] = "1";
    const db = await loadDb();
    const connection = db.initDatabase();

    expect(tableExists(connection, "junk")).toBe(false);
    expect(tableExists(connection, "customers")).toBe(true);
  });

  it("moves an unresettable file aside instead of deleting it", async () => {
    createUnresettableOwnedDatabase(fileDatabasePath());
    process.env[DATABASE_PATH_ENV] = fileDatabasePath();
    const db = await loadDb();
    const connection = db.initDatabase();

    expect(fs.existsSync(fileDatabasePath())).toBe(true);
    expect(tableExists(connection, "customers")).toBe(true);
    expect(tableExists(connection, "junk")).toBe(false);

    const movedFiles = corruptSiblings(tempDir);

    expect(movedFiles).toHaveLength(1);

    // The original data survives in the moved file; it was not deleted.
    const moved = new Database(path.join(tempDir, movedFiles[0] ?? ""));

    try {
      expect(
        moved
          .prepare("SELECT name FROM sqlite_master WHERE name = 'junk'")
          .get()
      ).toBeDefined();
    } finally {
      moved.close();
    }
  });
});

describe("migrations resolution", () => {
  it("resolves migrations from a development checkout", async () => {
    const devRoot = path.join(tempDir, "dev");
    copyMigrations(devRoot);
    electronState.appPath = devRoot;
    process.env[DATABASE_PATH_ENV] = ":memory:";
    const db = await loadDb();
    const connection = db.initDatabase();

    expect(tableExists(connection, "customers")).toBe(true);
  });

  it("resolves migrations from resources/drizzle in a packaged layout", async () => {
    const resources = path.join(tempDir, "packaged", "resources");
    copyMigrations(resources);
    electronState.appPath = path.join(resources, "app.asar");
    fs.mkdirSync(electronState.appPath, { recursive: true });
    electronState.isPackaged = true;
    process.env[DATABASE_PATH_ENV] = ":memory:";
    const db = await loadDb();
    const connection = db.initDatabase();

    expect(tableExists(connection, "customers")).toBe(true);
  });

  it("resolves migrations from the asar build layout used by e2e", async () => {
    const resources = path.join(tempDir, "e2e", "resources");
    copyMigrations(resources);
    const buildDirectory = path.join(resources, "app.asar", ".vite", "build");
    fs.mkdirSync(buildDirectory, { recursive: true });
    electronState.appPath = buildDirectory;
    electronState.isPackaged = false;
    process.env[DATABASE_PATH_ENV] = ":memory:";
    const db = await loadDb();
    const connection = db.initDatabase();

    expect(tableExists(connection, "customers")).toBe(true);
  });

  it("resolves migrations from process.resourcesPath", async () => {
    const resources = path.join(tempDir, "virtual-resources");
    copyMigrations(resources);
    electronState.appPath = path.join(tempDir, "elsewhere", "app");
    fs.mkdirSync(electronState.appPath, { recursive: true });
    setResourcesPath(resources);
    process.env[DATABASE_PATH_ENV] = ":memory:";
    const db = await loadDb();
    const connection = db.initDatabase();

    expect(tableExists(connection, "customers")).toBe(true);
  });

  it("fails with a clear error when the journal is missing", async () => {
    const emptyRoot = path.join(tempDir, "empty");
    fs.mkdirSync(emptyRoot, { recursive: true });
    electronState.appPath = emptyRoot;
    setResourcesPath(path.join(tempDir, "missing-resources"));
    process.env[DATABASE_PATH_ENV] = ":memory:";
    const db = await loadDb();

    let message = "";

    try {
      db.initDatabase();
    } catch (error) {
      ({ message } = error as Error);
    }

    expect(message).toMatch(MIGRATIONS_NOT_FOUND_PATTERN);
    expect(message).toContain(path.join(emptyRoot, "drizzle"));
  });
});
