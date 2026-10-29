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

test.beforeAll(async () => {
  const cache = createTempCacheDir();
  ({ tempDir } = cache);
  process.env.CI = "e2e";

  electronApp = await launchPackagedApp(cache.dbPath);
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
  expect(text).toBe("electron-shadcn");
});
