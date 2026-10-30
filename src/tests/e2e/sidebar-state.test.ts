import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  createTempCacheDir,
  launchPackagedApp,
  removeTempDir,
} from "./helpers";

const STORED_PREFERENCES = {
  language: "en",
  sidebarOpen: false,
  theme: "system",
  window: { height: 600, isMaximized: false, width: 800 },
};

/**
 * Covers the read half of the sidebar preference: a state stored before the
 * window opens must be applied once the renderer resolves it over IPC.
 * example.test.ts covers the write half by toggling the sidebar.
 */
test("restores a collapsed sidebar from the stored preference", async () => {
  const { dbPath, tempDir } = createTempCacheDir();
  const preferencesDir = path.join(tempDir, "preferences");

  // launchPackagedApp points APP_PREFERENCES_DIR at this directory, so seeding
  // the file here is what the app reads during startup.
  fs.mkdirSync(preferencesDir, { recursive: true });
  fs.writeFileSync(
    path.join(preferencesDir, "preferences.json"),
    JSON.stringify(STORED_PREFERENCES)
  );

  const app = await launchPackagedApp(dbPath, tempDir);

  try {
    const page = await app.firstWindow();

    await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute(
      "data-state",
      "collapsed",
      { timeout: 10_000 }
    );
  } finally {
    await app.close();
    removeTempDir(tempDir);
  }
});
