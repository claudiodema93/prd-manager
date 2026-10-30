import type { ElectronApplication } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  closePackagedApp,
  createTempCacheDir,
  launchPackagedApp,
  removeTempDir,
} from "./helpers";

/*
 * Renderer/main boundary: the preload MessagePort must carry data both ways
 * while the renderer itself keeps no Node access.
 */

let electronApp: ElectronApplication;
let tempDir: string;

test.beforeAll(async () => {
  const cache = createTempCacheDir();
  ({ tempDir } = cache);

  electronApp = await launchPackagedApp(cache.dbPath, cache.tempDir);
});

test.afterAll(async () => {
  await closePackagedApp(electronApp);
  removeTempDir(tempDir);
});

test("exchanges data with the main process over the sandboxed IPC bridge", async () => {
  const page = await electronApp.firstWindow();
  const version = await electronApp.evaluate(({ app }) => app.getVersion());

  // The version arrives through the preload MessagePort bridge; it stays at the
  // placeholder when the bridge is broken.
  await expect(page.getByText(`v${version}`)).toBeVisible({ timeout: 10_000 });
});

test("runs the renderer without Node integration", async () => {
  const page = await electronApp.firstWindow();

  expect(
    await page.evaluate(
      () => typeof (globalThis as { process?: unknown }).process
    )
  ).toBe("undefined");
  expect(
    await page.evaluate(
      () => typeof (globalThis as { require?: unknown }).require
    )
  ).toBe("undefined");
});
