import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { app } from "electron";
import { customers } from "./schema";

const schema = { customers };

export type SaugerDatabase = ReturnType<typeof drizzle<typeof schema>>;

let database: SaugerDatabase | null = null;

export function getDatabasePath(): string {
  const override = process.env.SAUGER_DB_PATH?.trim();

  if (!override) {
    return path.join(app.getPath("userData"), "sauger.db");
  }

  if (override === ":memory:") {
    return override;
  }

  const resolved = path.resolve(override);

  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    throw new Error(`SAUGER_DB_PATH points to a directory: "${resolved}".`);
  }

  return resolved;
}

export function getDatabase(): SaugerDatabase {
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
 * The database is a disposable cache: on startup it is recreated from scratch
 * only when SQLite reports the file as corrupt or not a database. Any other
 * failure (permissions, a missing migration folder, a locked file) is surfaced
 * as-is instead of destroying data that may still be valid.
 */
export function initDatabase(): SaugerDatabase {
  if (database) {
    return database;
  }

  const file = getDatabasePath();
  const migrationsFolder = getMigrationsFolder();

  assertMigrationsAvailable(migrationsFolder);

  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  try {
    database = createDatabase(file, migrationsFolder);
  } catch (error) {
    if (!isCorruptionError(error)) {
      throw error;
    }

    console.error(
      `[db] "${file}" is corrupted, deleting and recreating the cache database.`,
      error
    );
    removeDatabaseFiles(file);

    try {
      database = createDatabase(file, migrationsFolder);
    } catch (recoveryError) {
      throw new Error(`Unable to recreate the cache database at "${file}".`, {
        cause: recoveryError,
      });
    }
  }

  console.log(`[db] Ready at "${file}".`);

  return database;
}

function createDatabase(
  file: string,
  migrationsFolder: string
): SaugerDatabase {
  const sqlite = new Database(file);

  try {
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("journal_mode = WAL");

    const integrity = sqlite.pragma("quick_check", { simple: true });
    if (integrity !== "ok") {
      throw Object.assign(
        new Error(`SQLite quick_check failed: ${String(integrity)}`),
        { code: "SQLITE_CORRUPT" }
      );
    }

    const connection = drizzle({ client: sqlite, schema });
    migrate(connection, { migrationsFolder });

    return connection;
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

function getMigrationsFolder(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "drizzle")
    : path.join(app.getAppPath(), "drizzle");
}

function assertMigrationsAvailable(folder: string): void {
  const journal = path.join(folder, "meta", "_journal.json");

  if (!fs.existsSync(journal)) {
    throw new Error(
      `Drizzle migrations not found at "${folder}" (missing "${journal}").`
    );
  }
}

function isCorruptionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const { code } = error as { code?: unknown };

  return code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB";
}

function removeDatabaseFiles(file: string): void {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    fs.rmSync(`${file}${suffix}`, { force: true });
  }
}
