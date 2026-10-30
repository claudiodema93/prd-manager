import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { app } from "electron";
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
const DATABASE_PATH_ENV = "APP_CACHE_DB_PATH";
const SKIP_INTEGRITY_CHECK_ENV = "APP_CACHE_SKIP_INTEGRITY_CHECK";
const MEMORY_DATABASE = ":memory:";
const SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"] as const;

export type CacheDatabase = ReturnType<typeof drizzle<typeof schema>>;

interface DatabaseLocation {
  file: string;
  isDefault: boolean;
}

let database: CacheDatabase | null = null;
// Remembered so `closeDatabase` can re-tighten the file and sidecars without
// the caller having to pass the location again.
let currentLocation: DatabaseLocation | null = null;

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

  // Tighten the sidecars too, before SQLite removes them on close.
  if (currentLocation) {
    restrictPermissions(currentLocation);
  }

  database.$client.close();
  database = null;
  currentLocation = null;
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
  let fileStats: fs.Stats | undefined;

  if (!isMemory) {
    fs.mkdirSync(path.dirname(location.file), { recursive: true });

    // `existsSync` follows symlinks, so a dangling link would look absent and
    // SQLite would happily create its target. Decide existence with `lstat`
    // and refuse any link (including one that dangles) before opening.
    fileStats = fs.lstatSync(location.file, { throwIfNoEntry: false });
    assertNotSymlink(location.file, fileStats);

    for (const suffix of SIDECAR_SUFFIXES) {
      const sidecar = `${location.file}${suffix}`;
      const stats = fs.lstatSync(sidecar, { throwIfNoEntry: false });

      assertNotSymlink(sidecar, stats);
    }
  }

  try {
    if (!isMemory) {
      fileExisted = fileStats !== undefined;

      // Read-only check: a file that is not a SQLite database is never opened
      // for writing, never reset, and never moved. This guards against a stale
      // or mistaken env var pointing at an unrelated user file.
      if (fileStats) {
        assertIsSqliteFile(location, fileStats);
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

  if (!app.isPackaged) {
    console.log(`[db] Ready at "${location.file}".`);
  }

  currentLocation = location;
  restrictPermissions(location);

  return database;
}

/**
 * Refuses symbolic links (including dangling ones) before SQLite opens the
 * path, so the link's target is never created or modified.
 */
function assertNotSymlink(file: string, stats: fs.Stats | undefined): void {
  if (stats?.isSymbolicLink()) {
    throw new Error(
      `Refusing to use "${file}": it is a symbolic link. The path was not modified.`
    );
  }
}

/**
 * The cache holds customer names and absolute paths. Keep it readable only by
 * the current user; SQLite sidecars are created lazily, so they are adjusted
 * here and again on close.
 *
 * The parent directory is only tightened for the default `userData` location:
 * an override such as `/tmp/cache.db` must not chmod `/tmp` (or `$HOME`).
 */
function restrictPermissions(location: DatabaseLocation): void {
  const { file } = location;

  if (process.platform === "win32" || file === MEMORY_DATABASE) {
    return;
  }

  if (location.isDefault) {
    try {
      fs.chmodSync(path.dirname(file), 0o700);
    } catch (error) {
      console.warn(
        `[db] Could not restrict permissions on "${path.dirname(file)}".`,
        error
      );
    }
  }

  restrictFilePermissions(file);

  for (const suffix of ["-wal", "-shm"] as const) {
    const sidecar = `${file}${suffix}`;

    if (fs.existsSync(sidecar)) {
      restrictFilePermissions(sidecar);
    }
  }
}

function restrictFilePermissions(file: string): void {
  if (process.platform === "win32") {
    return;
  }

  try {
    fs.chmodSync(file, 0o600);
  } catch (error) {
    console.warn(`[db] Could not restrict permissions on "${file}".`, error);
  }
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
function assertIsSqliteFile(location: DatabaseLocation, stats: fs.Stats): void {
  const { file } = location;

  if (!stats.isFile()) {
    throw new Error(
      `Refusing to use "${file}": it is not a cache database (expected a file). The path was not modified.`
    );
  }

  if (stats.nlink > 1) {
    throw new Error(
      `Refusing to use "${file}": it has multiple hard links. The path was not modified.`
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
 * A sentinel of 0 means "never claimed": the default location is ours by
 * definition, and an override is adopted only when it is an empty database (a
 * new file we are about to initialise). Anything else — including another
 * Drizzle database, which merely has `__drizzle_migrations` — is left untouched.
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
    clearlyOurs = isEmptyDatabase(sqlite);
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

function isEmptyDatabase(sqlite: Database.Database): boolean {
  const tables = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    )
    .all() as { name: string }[];

  // Only a database with no user tables is safe to adopt: it cannot contain
  // another application's data.
  return tables.length === 0;
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
 * dropping the user tables fails. This is only reached after the ownership
 * check proved the file is ours (sentinel or a newly created empty file).
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
  restrictFilePermissions(target);

  for (const suffix of SIDECAR_SUFFIXES) {
    const sidecar = `${file}${suffix}`;

    if (fs.existsSync(sidecar)) {
      const movedSidecar = `${target}${suffix}`;

      fs.renameSync(sidecar, movedSidecar);
      restrictFilePermissions(movedSidecar);
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
  return ["", ...SIDECAR_SUFFIXES].some((suffix) =>
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
  const bases = ancestorDirectories(app.getAppPath(), 4);
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

function ancestorDirectories(start: string, maxDepth = 4): string[] {
  const directories: string[] = [];
  let current = path.resolve(start);

  for (let depth = 0; depth <= maxDepth; depth += 1) {
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

  return (
    code === "SQLITE_NOTADB" ||
    (typeof code === "string" && code.startsWith("SQLITE_CORRUPT"))
  );
}
