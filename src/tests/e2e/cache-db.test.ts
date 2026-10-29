import fs from "node:fs";
import type { ElectronApplication } from "@playwright/test";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import {
  createTempCacheDir,
  launchPackagedApp,
  removeTempDir,
} from "./helpers";

const SQLITE_HEADER = "SQLite format 3";

function readHeader(file: string): string {
  return fs
    .readFileSync(file)
    .subarray(0, SQLITE_HEADER.length)
    .toString("utf8");
}

/**
 * Corrupts the freelist trunk pointer in the database header while leaving the
 * 16-byte SQLite magic intact. `quick_check` reports the damage, but the schema
 * stays readable, so the app can reset the tables in place.
 */
function corruptDatabaseHeader(file: string): void {
  const contents = fs.readFileSync(file);
  contents.writeUInt32BE(9999, 32);
  fs.writeFileSync(file, contents);
}

function listTables(file: string): string[] {
  const probe = new Database(file, { readonly: true });

  try {
    return (
      probe
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((table) => table.name);
  } finally {
    probe.close();
  }
}

function countCustomers(file: string): number {
  const probe = new Database(file, { readonly: true });

  try {
    return (
      probe.prepare("SELECT COUNT(*) AS count FROM customers").get() as {
        count: number;
      }
    ).count;
  } finally {
    probe.close();
  }
}

/**
 * Adds data that a successful in-place reset must discard: a customer row and
 * an unrelated table.
 */
function seedStaleData(file: string): void {
  const database = new Database(file);

  try {
    database.exec("CREATE TABLE junk (value TEXT)");
    database
      .prepare(
        "INSERT INTO customers (folder_path, customer_code, folder_name, folder_mtime_ms, status) VALUES (?, ?, ?, ?, ?)"
      )
      .run("/customers/stale", "STALE-001", "Stale", 1, "ok");
  } finally {
    database.close();
  }
}

/**
 * The cache database is disposable: it must be created on first launch and
 * transparently recreated when the existing file is corrupt.
 *
 * These tests launch the real packaged app, so they run serially and always
 * close the previous instance first (the app holds a single-instance lock).
 */
test.describe
  .serial("cache database lifecycle", () => {
    const openApps: ElectronApplication[] = [];
    const tempDirs: string[] = [];
    let currentApp: ElectronApplication | undefined;

    test.afterAll(async () => {
      await Promise.all(
        openApps.map((app) => app.close().catch(() => undefined))
      );

      for (const tempDir of tempDirs) {
        removeTempDir(tempDir);
      }
    });

    async function launchFresh(
      dbPath: string,
      homeDir: string
    ): Promise<ElectronApplication> {
      if (currentApp) {
        await currentApp.close().catch(() => undefined);
        currentApp = undefined;
      }

      currentApp = await launchPackagedApp(dbPath, homeDir);
      openApps.push(currentApp);

      return currentApp;
    }

    test("creates the cache database on first launch", async () => {
      const { dbPath, tempDir } = createTempCacheDir();
      tempDirs.push(tempDir);

      const app = await launchFresh(dbPath, tempDir);
      const page = await app.firstWindow();
      await page.waitForSelector("h1");

      expect(fs.existsSync(dbPath)).toBe(true);
      expect(readHeader(dbPath)).toBe(SQLITE_HEADER);
    });

    test("resets a corrupt cache database in place and still renders the window", async () => {
      const { dbPath, tempDir } = createTempCacheDir();
      tempDirs.push(tempDir);

      const first = await launchFresh(dbPath, tempDir);
      const firstPage = await first.firstWindow();
      await firstPage.waitForSelector("h1");

      expect(readHeader(dbPath)).toBe(SQLITE_HEADER);

      await first.close();
      currentApp = undefined;

      seedStaleData(dbPath);
      expect(countCustomers(dbPath)).toBe(1);

      corruptDatabaseHeader(dbPath);

      const app = await launchFresh(dbPath, tempDir);
      const page = await app.firstWindow();
      await page.waitForSelector("h1");

      await app.close();
      currentApp = undefined;

      const tables = listTables(dbPath);

      // The file survives, the schema is rebuilt in place and the stale data is
      // gone: nothing was deleted and no move-aside copy was needed.
      expect(readHeader(dbPath)).toBe(SQLITE_HEADER);
      expect(tables).toContain("customers");
      expect(tables).not.toContain("junk");
      expect(countCustomers(dbPath)).toBe(0);
      expect(
        fs.readdirSync(tempDir).filter((name) => name.includes(".corrupt-"))
      ).toEqual([]);
    });
  });
