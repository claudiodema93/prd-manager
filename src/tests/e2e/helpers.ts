import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
} from "@playwright/test";
import { findLatestBuild, parseElectronApp } from "electron-playwright-helpers";

/**
 * Helpers shared by the packaged-app end-to-end tests.
 *
 * Playwright must launch the packaged executable, not stock Electron with the
 * asar entry point: launching Electron directly makes `app.isPackaged` false
 * and `app.getAppPath()` resolve inside `app.asar`, so database startup fails
 * and no window is ever created.
 */

function getProcessEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );
}

export function createTempCacheDir(): { dbPath: string; tempDir: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sauger-e2e-"));

  return { dbPath: path.join(tempDir, "cache.db"), tempDir };
}

export function launchPackagedApp(
  dbPath: string,
  homeDir: string
): Promise<ElectronApplication> {
  const { executable } = parseElectronApp(findLatestBuild());

  return electron.launch({
    env: {
      ...getProcessEnv(),
      // Isolate Electron's userData (and therefore the single-instance lock)
      // from the developer's real profile.
      APPDATA: homeDir,
      HOME: homeDir,
      SAUGER_CACHE_DB_PATH: dbPath,
      XDG_CONFIG_HOME: path.join(homeDir, ".config"),
    },
    executablePath: executable,
  });
}

export function removeTempDir(tempDir: string): void {
  fs.rmSync(tempDir, { force: true, recursive: true });
}
