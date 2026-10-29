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

    async function launchFresh(dbPath: string): Promise<ElectronApplication> {
      if (currentApp) {
        await currentApp.close().catch(() => undefined);
        currentApp = undefined;
      }

      currentApp = await launchPackagedApp(dbPath);
      openApps.push(currentApp);

      return currentApp;
    }

    test("creates the cache database on first launch", async () => {
      const { dbPath, tempDir } = createTempCacheDir();
      tempDirs.push(tempDir);

      const app = await launchFresh(dbPath);
      const page = await app.firstWindow();
      await page.waitForSelector("h1");

      expect(fs.existsSync(dbPath)).toBe(true);
      expect(readHeader(dbPath)).toBe(SQLITE_HEADER);
    });

    test("resets a corrupt cache database in place and still renders the window", async () => {
      const { dbPath, tempDir } = createTempCacheDir();
      tempDirs.push(tempDir);

      const first = await launchFresh(dbPath);
      const firstPage = await first.firstWindow();
      await firstPage.waitForSelector("h1");

      expect(readHeader(dbPath)).toBe(SQLITE_HEADER);

      await first.close();
      currentApp = undefined;

      corruptDatabaseHeader(dbPath);

      const app = await launchFresh(dbPath);
      const page = await app.firstWindow();
      await page.waitForSelector("h1");

      await app.close();
      currentApp = undefined;

      // The file survives and the schema is rebuilt; nothing is deleted.
      expect(readHeader(dbPath)).toBe(SQLITE_HEADER);
      expect(listTables(dbPath)).toContain("customers");
    });
  });
