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

  // The site header renders an <h1> with the page title before the route
  // content mounts, so the first heading on the page is "Home Page". Target
  // the route heading explicitly instead of the first h1 in DOM order.
  await expect(page.getByRole("heading", { name: "PrdManager" })).toBeVisible({
    timeout: 10_000,
  });
});

/*
 * Navigation is asserted here; the blocked-navigation test lives in
 * navigation.test.ts because it needs its own app instance.
 */
test("navigates with the sidebar and marks the active route", async () => {
  const page: Page = await electronApp.firstWindow();

  const homeLink = page.getByRole("link", { name: "Home Page" });
  const secondLink = page.getByRole("link", { name: "Second Page" });

  await expect(homeLink).toBeVisible();
  await expect(secondLink).toBeVisible();
  // Documentation goes through ExternalLink, which renders a button rather
  // than an anchor because it hands the URL to the main process.
  await expect(
    page.getByRole("button", { name: "Documentation" })
  ).toBeVisible();

  await expect(homeLink).toHaveAttribute("data-active", "true");
  await expect(homeLink).toHaveAttribute("aria-current", "page");
  await expect(secondLink).toHaveAttribute("data-active", "false");

  await secondLink.click();

  await expect(page.locator("header h1")).toHaveText("Second Page");
  await expect(secondLink).toHaveAttribute("data-active", "true");
  await expect(secondLink).toHaveAttribute("aria-current", "page");
  await expect(homeLink).toHaveAttribute("data-active", "false");

  // Leave the app on the home route for the tests that run after this one.
  await homeLink.click();

  await expect(page.locator("header h1")).toHaveText("Home Page");
});

/*
 * Also guards shutdown: while the sidebar wrote `document.cookie` on toggle,
 * toggling it left the packaged app running and this suite's `afterAll` close
 * timed out.
 */
test("toggles the sidebar", async () => {
  const page: Page = await electronApp.firstWindow();
  const trigger = page
    .locator("header")
    .getByRole("button", { name: "Toggle Sidebar" });
  const sidebar = page.locator('[data-slot="sidebar"]');

  await expect(sidebar).toHaveAttribute("data-state", "expanded");

  await trigger.click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");

  await trigger.click();
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
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
