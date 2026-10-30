import { defineConfig, devices } from "@playwright/test";

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: "html",
  retries: process.env.CI ? 2 : 0,
  testDir: "./src/tests/e2e",
  use: {
    trace: "on-first-retry",
  },
  // The app enforces a single-instance lock, so only one packaged instance may
  // run at a time; test files must not execute concurrently.
  workers: 1,
});
