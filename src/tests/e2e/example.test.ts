import type { ElectronApplication, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  createTempCacheDir,
  launchPackagedApp,
  removeTempDir,
} from "./helpers";

/*
 * Using Playwright with Electron:
 * https://www.electronjs.org/pt/docs/latest/tutorial/automated-testing#using-playwright
 */

let electronApp: ElectronApplication;
let tempDir: string;

const EXTERNAL_NAVIGATION_PATTERN = /example\.com/u;

test.beforeAll(async () => {
  const cache = createTempCacheDir();
  ({ tempDir } = cache);

  electronApp = await launchPackagedApp(cache.dbPath, cache.tempDir);
  electronApp.on("window", (page) => {
    const filename = page.url()?.split("/").pop();
    console.log(`Window opened: ${filename}`);

    page.on("pageerror", (error) => {
      console.error(error);
    });
    page.on("console", (msg) => {
      console.log(msg.text());
    });
  });
});

test.afterAll(async () => {
  await electronApp?.close();
  removeTempDir(tempDir);
});

test("renders the first page", async () => {
  const page: Page = await electronApp.firstWindow();

  const title = await page.waitForSelector("h1");
  const text = await title.textContent();
  expect(text).toBe("PrdManager");
});

test("exchanges data with the main process over the sandboxed IPC bridge", async () => {
  const page: Page = await electronApp.firstWindow();
  const version = await electronApp.evaluate(({ app }) => app.getVersion());

  // The version arrives through the preload MessagePort bridge; it stays at the
  // placeholder when the bridge is broken.
  await expect(page.getByText(`v${version}`)).toBeVisible({ timeout: 10_000 });
});

test("runs the renderer without Node integration", async () => {
  const page: Page = await electronApp.firstWindow();

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
