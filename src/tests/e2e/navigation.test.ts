import type { ElectronApplication, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  closePackagedApp,
  createTempCacheDir,
  launchPackagedApp,
  removeTempDir,
} from "./helpers";

/*
 * Kept in its own file, with its own app instance: a blocked
 * `window.location` assignment leaves the renderer with a navigation that
 * Playwright keeps waiting for, which makes later locator assertions time out
 * and can hang `electronApp.close()`. Running it last in a shared app made the
 * whole suite depend on test order.
 */

let electronApp: ElectronApplication;
let tempDir: string;

const EXTERNAL_NAVIGATION_PATTERN = /example\.com/u;

test.beforeAll(async () => {
  const cache = createTempCacheDir();
  ({ tempDir } = cache);

  electronApp = await launchPackagedApp(cache.dbPath, cache.tempDir);
});

test.afterAll(async () => {
  // The blocked navigation can leave graceful shutdown waiting; the helper
  // bounds the close and forces the process down instead of failing the hook.
  await closePackagedApp(electronApp);
  removeTempDir(tempDir);
});

test("blocks window.open and off-app navigation", async () => {
  const page: Page = await electronApp.firstWindow();
  const before = page.url();

  expect(
    await page.evaluate(() => window.open("https://example.com"))
  ).toBeNull();

  await page.evaluate(() => {
    window.location.href = "https://example.com/";
  });

  // Race the navigation against a short grace period: a blocked navigation
  // never resolves waitForURL, so it must lose the race.
  const navigated = await Promise.race([
    page
      .waitForURL(EXTERNAL_NAVIGATION_PATTERN, { timeout: 1000 })
      .then(() => true)
      .catch(() => false),
    new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), 500);
    }),
  ]);

  expect(navigated).toBe(false);
  expect(page.url()).toBe(before);
  expect(electronApp.windows()).toHaveLength(1);
});
