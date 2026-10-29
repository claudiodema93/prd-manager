import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { app } from "electron";
import { inDevelopment } from "../constants";
import { customers } from "./schema";

const schema = { customers };

/** The 16-byte header every SQLite database starts with. */
const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "binary");

/**
 * `application_id` sentinel ("CACH") written into every cache database this
 * app creates or adopts. It lets a later run tell our disposable cache apart
 * from a SQLite file owned by another application.
 */
const CACHE_APPLICATION_ID = 0x43_41_43_48;

const DEFAULT_DATABASE_FILE = "cache.db";
const DATABASE_PATH_ENV = "SAUGER_CACHE_DB_PATH";
const SKIP_INTEGRITY_CHECK_ENV = "SAUGER_CACHE_SKIP_INTEGRITY_CHECK";
const MEMORY_DATABASE = ":memory:";

export type CacheDatabase = ReturnType<typeof drizzle<typeof schema>>;

let database: CacheDatabase | null = null;

interface DatabaseLocation {
  file: string;
  isDefault: boolean;
}

export function getDatabase(): CacheDatabase {
  if (!database) {
    throw new Error(
      "Database has not been initialised. Call initDatabase() first."
    );
  }

  return database;
}

export function closeDatabase(): void {
  if (!database) {
    return;
  }

  database.$client.close();
  database = null;
}

/**
 * The database is a disposable cache: on startup it is reset (or, when that is
 * impossible, moved aside and recreated) only when SQLite reports the file as
 * corrupt or not a database. Any other failure (permissions, a missing
 * migration folder, a locked file) is surfaced as-is instead of destroying data
 * that may still be valid.
 */
export function initDatabase(): CacheDatabase {
  if (database) {
    return database;
  }

  const location = getDatabasePath();
  const migrationsFolder = getMigrationsFolder();
  const isMemory = location.file === MEMORY_DATABASE;

  let fileExisted = false;

  if (!isMemory) {
    fs.mkdirSync(path.dirname(location.file), { recursive: true });
  }

  try {
    if (!isMemory) {
      fileExisted = fs.existsSync(location.file);

      // Read-only check: a file that is not a SQLite database is never opened
      // for writing, never reset, and never moved. This guards against a stale
      // or mistaken env var pointing at an unrelated user file.
      if (fileExisted) {
        assertIsSqliteFile(location);
      }
    }

    database = createDatabase(location, migrationsFolder, fileExisted);
  } catch (error) {
    if (!isCorruptionError(error)) {
      throw error;
    }

    console.error(
      `[db] "${location.file}" is corrupted, resetting the cache database.`,
      error
    );
    database = recoverDatabase(location, migrationsFolder);
  }

  if (inDevelopment) {
    console.log(`[db] Ready at "${location.file}".`);
  }

  return database;
}

function getDatabasePath(): DatabaseLocation {
  const defaultFile = path.join(app.getPath("userData"), DEFAULT_DATABASE_FILE);
  const override = process.env[DATABASE_PATH_ENV]?.trim();

  // A blank value (including whitespace-only) is treated as unset.
  if (!override) {
    return { file: defaultFile, isDefault: true };
  }

  if (override === MEMORY_DATABASE) {
    return { file: MEMORY_DATABASE, isDefault: false };
  }

  if (!path.isAbsolute(override)) {
    throw new Error(
      `${DATABASE_PATH_ENV} must be an absolute path (received "${override}"). Relative paths resolve differently in development and packaged builds.`
    );
  }

  const resolved = path.resolve(override);

  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    throw new Error(
      `${DATABASE_PATH_ENV} points to a directory: "${resolved}".`
    );
  }

  return {
    file: resolved,
    isDefault: resolved === path.resolve(defaultFile),
  };
}

function createDatabase(
  location: DatabaseLocation,
  migrationsFolder: string,
  fileExisted: boolean
): CacheDatabase {
  const sqlite = new Database(location.file);

  try {
    if (location.file === MEMORY_DATABASE) {
      sqlite.pragma(`application_id = ${CACHE_APPLICATION_ID}`);
    } else {
      assertCacheOwnership(sqlite, location);
    }

    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("journal_mode = WAL");

    // The integrity check is O(database size) and blocks startup, so it is
    // skipped for a freshly created file and can be disabled in development.
    if (fileExisted && shouldCheckIntegrity()) {
      assertIntegrity(sqlite);
    }

    const connection = drizzle({ client: sqlite, schema });
    migrate(connection, { migrationsFolder });

    return connection;
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

/**
 * SQLite files are identified by a fixed 16-byte header. A file that is not
 * SQLite is never opened for writing. On an override path it is also never
 * reset or moved, because it may belong to an unrelated application. Only the
 * default `userData` location is recovered (by moving the damaged file aside,
 * never by deleting it), so a truncated or header-damaged cache cannot wedge
 * startup forever.
 */
function assertIsSqliteFile(location: DatabaseLocation): void {
  const { file } = location;
  const stats = fs.statSync(file);

  if (!stats.isFile()) {
    throw new Error(
      `Refusing to use "${file}": it is not a cache database (expected a file). The path was not modified.`
    );
  }

  // An empty file is not a foreign database: SQLite initialises it in place.
  if (stats.size === 0) {
    return;
  }

  if (stats.size < SQLITE_HEADER.length) {
    rejectNonCacheDatabase(location);

    return;
  }

  const header = Buffer.alloc(SQLITE_HEADER.length);
  const descriptor = fs.openSync(file, "r");

  try {
    fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }

  if (!header.equals(SQLITE_HEADER)) {
    rejectNonCacheDatabase(location);
  }
}

/**
 * A non-SQLite file at the default location is treated as a damaged cache and
 * routed through the recovery path, which moves it aside. Anywhere else it is
 * refused and left untouched.
 */
function rejectNonCacheDatabase(location: DatabaseLocation): void {
  if (!location.isDefault) {
    throw notACacheDatabaseError(location.file);
  }

  throw Object.assign(
    new Error(
      `"${location.file}" is not a SQLite database; the default cache will be moved aside and recreated.`
    ),
    { code: "SQLITE_NOTADB" }
  );
}

function notACacheDatabaseError(file: string): Error {
  return new Error(
    `Refusing to use "${file}": it is not a cache database (missing the "SQLite format 3" header). The file was not modified or deleted.`
  );
}

/**
 * Refuses to touch a SQLite file that cannot be shown to belong to this app.
 * A sentinel of 0 means "never claimed", which is adopted for our default
 * location and for files that are recognisably ours (empty, or carrying the
 * Drizzle migrations table). Anything else is left untouched.
 */
function assertCacheOwnership(
  sqlite: Database.Database,
  location: DatabaseLocation
): void {
  let applicationId: number;

  try {
    applicationId = Number(sqlite.pragma("application_id", { simple: true }));
  } catch (error) {
    // A corrupt file in our own userData directory is ours by location and is
    // handled by the recovery path. An override path we cannot verify is left
    // alone, because it may belong to another application.
    if (location.isDefault) {
      throw error;
    }

    throw new Error(
      `Refusing to use "${location.file}": could not verify that it belongs to this app. The file was not modified.`,
      { cause: error }
    );
  }

  if (applicationId === CACHE_APPLICATION_ID) {
    return;
  }

  if (applicationId !== 0) {
    throw new Error(
      `Refusing to use "${location.file}" as the cache database: it belongs to another application (application_id ${applicationId}). The file was not modified.`
    );
  }

  if (location.isDefault) {
    sqlite.pragma(`application_id = ${CACHE_APPLICATION_ID}`);
    return;
  }

  let clearlyOurs: boolean;

  try {
    clearlyOurs = isClearlyOurDatabase(sqlite);
  } catch (error) {
    // An unreadable schema on an override path cannot be attributed to this
    // app, so it must not be reset or moved.
    throw new Error(
      `Refusing to use "${location.file}": could not verify that it belongs to this app. The file was not modified.`,
      { cause: error }
    );
  }

  if (!clearlyOurs) {
    throw new Error(
      `Refusing to use "${location.file}" as the cache database: it is an existing SQLite database that does not belong to this app. The file was not modified.`
    );
  }

  sqlite.pragma(`application_id = ${CACHE_APPLICATION_ID}`);
}

function isClearlyOurDatabase(sqlite: Database.Database): boolean {
  const tables = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    )
    .all() as { name: string }[];

  // An empty database has nothing worth protecting, and the migrations table
  // is a strong signal that this file was created by Drizzle.
  return (
    tables.length === 0 ||
    tables.some(({ name }) => name === "__drizzle_migrations")
  );
}

function shouldCheckIntegrity(): boolean {
  // Packaged builds always verify: silently running on a damaged cache would
  // only surface as unrelated failures later. Development may opt out for
  // speed when iterating on a large cache.
  if (app.isPackaged) {
    return true;
  }

  return process.env[SKIP_INTEGRITY_CHECK_ENV] !== "1";
}

function assertIntegrity(sqlite: Database.Database): void {
  const result = sqlite.pragma("quick_check", { simple: true });

  if (result !== "ok") {
    throw Object.assign(
      new Error(`SQLite quick_check failed: ${String(result)}`),
      { code: "SQLITE_CORRUPT" }
    );
  }
}

/**
 * Resets the schema inside the existing file. The file itself always survives
 * this path; it is only moved aside when even reading `sqlite_master` or
 * dropping the user tables fails.
 */
function resetDatabaseInPlace(
  location: DatabaseLocation,
  migrationsFolder: string
): CacheDatabase {
  const sqlite = new Database(location.file);

  try {
    sqlite.pragma("foreign_keys = OFF");

    sqlite.transaction(() => {
      const tables = sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'"
        )
        .all() as { name: string }[];

      for (const { name } of tables) {
        sqlite.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(name)}`);
      }

      const migrationsTable = sqlite
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'"
        )
        .get();

      if (migrationsTable) {
        sqlite.exec("DELETE FROM __drizzle_migrations");
      }
    })();

    sqlite.pragma(`application_id = ${CACHE_APPLICATION_ID}`);
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("journal_mode = WAL");

    const connection = drizzle({ client: sqlite, schema });
    migrate(connection, { migrationsFolder });

    return connection;
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

function recoverDatabase(
  location: DatabaseLocation,
  migrationsFolder: string
): CacheDatabase {
  try {
    return resetDatabaseInPlace(location, migrationsFolder);
  } catch (resetError) {
    console.error(
      `[db] In-place reset of "${location.file}" failed, moving it aside.`,
      resetError
    );
  }

  let movedTo: string;

  try {
    movedTo = moveDatabaseAside(location.file);
  } catch (moveError) {
    throw new Error(
      `Cache database at "${location.file}" is corrupt and could not be reset in place or moved aside. The file was not deleted.`,
      { cause: moveError }
    );
  }

  try {
    return createDatabase(location, migrationsFolder, false);
  } catch (recoveryError) {
    throw new Error(
      `Unable to recreate the cache database at "${location.file}". The corrupt file was moved to "${movedTo}".`,
      { cause: recoveryError }
    );
  }
}

/**
 * Moves a corrupt database (and its SQLite sidecars) to a timestamped sibling.
 * Nothing is ever deleted: the user can inspect or remove the file themselves.
 */
function moveDatabaseAside(file: string): string {
  const target = nextCorruptPath(file);

  fs.renameSync(file, target);

  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const sidecar = `${file}${suffix}`;

    if (fs.existsSync(sidecar)) {
      fs.renameSync(sidecar, `${target}${suffix}`);
    }
  }

  return target;
}

function nextCorruptPath(file: string): string {
  const base = `${file}.corrupt-${Date.now()}`;
  let candidate = base;
  let counter = 1;

  while (corruptPathExists(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }

  return candidate;
}

function corruptPathExists(candidate: string): boolean {
  return ["", "-wal", "-shm", "-journal"].some((suffix) =>
    fs.existsSync(`${candidate}${suffix}`)
  );
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * Finds the folder that actually ships `meta/_journal.json`. The application
 * can be running from a dev checkout, a packaged `resources/app.asar`, or a
 * stock Electron launching `resources/app.asar/.vite/build/main.cjs` inside an
 * asar, so walk up from the app path instead of trusting `isPackaged`.
 */
function getMigrationsFolder(): string {
  const bases = ancestorDirectories(app.getAppPath());
  const { resourcesPath } = process;

  if (typeof resourcesPath === "string" && resourcesPath.length > 0) {
    bases.push(path.resolve(resourcesPath));
    bases.push(path.join(path.resolve(resourcesPath), "app.asar.unpacked"));
  }

  const tried: string[] = [];

  for (const base of bases) {
    const folder = path.join(base, "drizzle");

    if (tried.includes(folder)) {
      continue;
    }

    tried.push(folder);

    if (fs.existsSync(path.join(folder, "meta", "_journal.json"))) {
      return folder;
    }
  }

  throw new Error(
    `Drizzle migrations not found (no "meta/_journal.json" in any expected location). Tried:\n${tried
      .map((folder) => `  - ${folder}`)
      .join("\n")}`
  );
}

function ancestorDirectories(start: string): string[] {
  const directories: string[] = [];
  let current = path.resolve(start);

  for (;;) {
    directories.push(current);

    const parent = path.dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }

  return directories;
}

function isCorruptionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const { code } = error as { code?: unknown };

  return code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB";
}
