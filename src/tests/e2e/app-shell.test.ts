import type { ElectronApplication, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  closePackagedApp,
  createTempCacheDir,
  launchPackagedApp,
  removeTempDir,
} from "./helpers";

/*
 * Sidebar shell behaviour. These assertions share one packaged app because
 * they only read and navigate the same window; the blocked-navigation test
 * lives in navigation.test.ts because it needs its own app instance.
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

test("renders the home page", async () => {
  const page: Page = await electronApp.firstWindow();

  // The site header renders an <h1> with the page title before the route
  // content mounts, so the first heading on the page is "Pagina iniziale".
  // Target the route heading explicitly instead of the first h1 in DOM order.
  await expect(page.getByRole("heading", { name: "PrdManager" })).toBeVisible({
    timeout: 10_000,
  });
});

test("navigates with the sidebar and marks the active route", async () => {
  const page: Page = await electronApp.firstWindow();

  const homeLink = page.getByRole("link", { name: "Pagina iniziale" });
  const secondLink = page.getByRole("link", { name: "Seconda pagina" });

  await expect(homeLink).toBeVisible();
  await expect(secondLink).toBeVisible();
  // Documentation goes through ExternalLink, which renders a button rather
  // than an anchor because it hands the URL to the main process.
  await expect(
    page.getByRole("button", { name: "Documentazione" })
  ).toBeVisible();

  await expect(homeLink).toHaveAttribute("data-active", "true");
  await expect(homeLink).toHaveAttribute("aria-current", "page");
  await expect(secondLink).toHaveAttribute("data-active", "false");

  await secondLink.click();

  await expect(page.locator("header h1")).toHaveText("Seconda pagina");
  await expect(secondLink).toHaveAttribute("data-active", "true");
  await expect(secondLink).toHaveAttribute("aria-current", "page");
  await expect(homeLink).toHaveAttribute("data-active", "false");

  // Leave the app on the home route for the tests that run after this one.
  await homeLink.click();

  await expect(page.locator("header h1")).toHaveText("Pagina iniziale");
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
