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

const PRODUCT_NAME = "PrdManager";
const PACKAGE_COMMAND = "APP_E2E=1 npm run package";

/**
 * Environment variables the packaged app may inherit. Anything else in the
 * host environment (tokens, NODE_OPTIONS, proxy credentials, CI markers) is
 * deliberately dropped so a test run cannot leak secrets into the app or
 * change its startup behaviour.
 *
 * HOME, APPDATA and XDG_CONFIG_HOME are always replaced with the per-test
 * temporary directory, never forwarded.
 */
const ENV_ALLOWLIST = [
  "PATH",
  "DISPLAY",
  // xvfb-run authenticates the X server with a temporary Xauthority file and
  // exports XAUTHORITY. Without it, Electron reports "Authorization required"
  // and then "Missing X server or $DISPLAY" on CI.
  "XAUTHORITY",
  "WAYLAND_DISPLAY",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TZ",
] as const;

function getProcessEnv(homeDir: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];

    if (value !== undefined) {
      env[key] = value;
    }
  }

  // Isolate Electron's userData (and therefore the single-instance lock) from
  // the developer's real profile.
  env.APPDATA = homeDir;
  env.HOME = homeDir;
  env.XDG_CONFIG_HOME = path.join(homeDir, ".config");

  return env;
}

/**
 * The directory `electron-forge package` writes on this host, e.g.
 * `out/PrdManager-darwin-arm64`. Forge names the output directory from the
 * package productName plus the target platform and architecture.
 */
function expectedBuildDirectory(): string {
  return path.join(
    process.cwd(),
    "out",
    `${PRODUCT_NAME}-${process.platform}-${process.arch}`
  );
}

function resolveBuildDirectory(): string {
  const expected = expectedBuildDirectory();

  if (fs.existsSync(expected)) {
    return expected;
  }

  // Only used when the deterministically named directory is absent (for
  // example an older forge layout). It is never preferred, because it can pick
  // a stale build of a different product.
  try {
    return findLatestBuild();
  } catch (error) {
    throw new Error(
      `No packaged app found at "${expected}". Run \`${PACKAGE_COMMAND}\` before the e2e suite.`,
      { cause: error }
    );
  }
}

function resolveExecutable(): string {
  const buildDirectory = resolveBuildDirectory();
  const app = parseElectronApp(buildDirectory);

  if (app.packageJson.productName !== PRODUCT_NAME) {
    throw new Error(
      `Refusing to launch "${buildDirectory}": expected package productName "${PRODUCT_NAME}", found "${String(
        app.packageJson.productName
      )}". Run \`${PACKAGE_COMMAND}\` to rebuild.`
    );
  }

  return app.executable;
}

export function createTempCacheDir(): { dbPath: string; tempDir: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "app-e2e-"));

  return { dbPath: path.join(tempDir, "cache.db"), tempDir };
}

export function launchPackagedApp(
  dbPath: string,
  homeDir: string
): Promise<ElectronApplication> {
  return electron.launch({
    env: {
      ...getProcessEnv(homeDir),
      APP_CACHE_DB_PATH: dbPath,
      // The packaged app honours these only in its E2E build.
      APP_E2E: "1",
      APP_PREFERENCES_DIR: path.join(homeDir, "preferences"),
      APP_USER_DATA_DIR: path.join(homeDir, "userData"),
    },
    executablePath: resolveExecutable(),
  });
}

export function removeTempDir(tempDir: string): void {
  fs.rmSync(tempDir, { force: true, recursive: true });
}

const APP_CLOSE_TIMEOUT_MS = 5000;

/**
 * Closes a packaged app without waiting forever. On macOS the app stays alive
 * after its last window closes (the platform convention), so Playwright's
 * `close()` can otherwise reach the 30 s hook timeout and fail an otherwise
 * green test file.
 */
export async function closePackagedApp(
  app: ElectronApplication | undefined
): Promise<void> {
  if (!app) {
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      app.close().catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, APP_CLOSE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }

  try {
    app.process().kill();
  } catch {
    // Already exited.
  }
}
