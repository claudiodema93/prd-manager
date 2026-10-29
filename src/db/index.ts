import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  type BetterSQLite3Database,
  drizzle,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { app } from "electron";
import { customers } from "./schema";

const schema = { customers };

export type SaugerDatabase = BetterSQLite3Database<typeof schema>;

let database: SaugerDatabase | null = null;

export function getDatabasePath(): string {
  return (
    process.env.SAUGER_DB_PATH ??
    path.join(app.getPath("userData"), "sauger.db")
  );
}

export function getDatabase(): SaugerDatabase {
  if (!database) {
    throw new Error(
      "Database has not been initialised. Call initDatabase() first."
    );
  }

  return database;
}

/**
 * The database is a disposable cache: on startup it is recreated from scratch
 * if it is corrupted or if the migrations cannot be applied.
 */
export function initDatabase(): SaugerDatabase {
  if (database) {
    return database;
  }

  const file = getDatabasePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  try {
    database = createDatabase(file);
  } catch (error) {
    console.error(
      `[db] Unable to open "${file}", deleting and recreating the cache database.`,
      error
    );
    removeDatabaseFiles(file);
    database = createDatabase(file);
  }

  console.log(`[db] Ready at "${file}".`);

  return database;
}

function createDatabase(file: string): SaugerDatabase {
  const sqlite = new Database(file);

  try {
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("journal_mode = WAL");

    const integrity = sqlite.pragma("quick_check", { simple: true });
    if (integrity !== "ok") {
      throw new Error(`SQLite quick_check failed: ${String(integrity)}`);
    }

    const connection = drizzle({ client: sqlite, schema });
    migrate(connection, { migrationsFolder: getMigrationsFolder() });

    return connection;
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

function getMigrationsFolder(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "drizzle")
    : path.join(process.cwd(), "drizzle");
}

function removeDatabaseFiles(file: string): void {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    fs.rmSync(`${file}${suffix}`, { force: true });
  }
}
