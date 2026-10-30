import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  createTempCacheDir,
  launchPackagedApp,
  removeTempDir,
} from "./helpers";

const DARK_CLASS_PATTERN = /dark/u;

interface PreferencesFile {
  language: string;
  theme: string;
  window: {
    height: number;
    isMaximized: boolean;
    width: number;
  };
}

function readPreferences(userData: string): PreferencesFile | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(userData, "preferences.json"), "utf8")
    ) as PreferencesFile;
  } catch {
    // The store writes atomically; a read can race the rename or the file may
    // not exist yet. Polling retries it.
    return null;
  }
}

/**
 * Launches the packaged app and drives the real renderer, so the IPC
 * preferences namespace and electron-store are exercised end to end.
 */
test("persists theme, language and window state", async () => {
  const { dbPath, tempDir } = createTempCacheDir();
  let app = await launchPackagedApp(dbPath, tempDir);

  try {
    const page = await app.firstWindow();
    // launchPackagedApp points APP_PREFERENCES_DIR at the per-test temp dir.
    const preferencesDir = path.join(tempDir, "preferences");

    await expect.poll(() => readPreferences(preferencesDir)).not.toBeNull();

    const languageButton = page.getByRole("radio", { name: "PT-BR" });
    await expect(languageButton).toBeVisible();
    await languageButton.click();

    const themeButton = page.getByRole("button", { name: "Toggle theme" });
    await expect(themeButton).toBeVisible();
    await themeButton.click();

    await expect
      .poll(() => readPreferences(preferencesDir)?.language)
      .toBe("pt-BR");
    await expect
      .poll(() => readPreferences(preferencesDir)?.theme)
      .not.toBe("system");

    await app.evaluate(({ BrowserWindow }) => {
      const [window] = BrowserWindow.getAllWindows();
      window?.setBounds({ height: 700, width: 900 });
    });

    // The main process debounces resize events before writing the store.
    await expect
      .poll(() => readPreferences(preferencesDir)?.window)
      .toMatchObject({ height: 700, width: 900 });

    const storedTheme = readPreferences(preferencesDir)?.theme;

    expect(storedTheme).not.toBe("system");

    // Relaunch against the same temp dir: this exercises the restore path in
    // main (stored theme applied before the window, bounds restored) and the
    // renderer sync, not just the write path.
    await app.close();
    app = await launchPackagedApp(dbPath, tempDir);

    const restoredPage = await app.firstWindow();

    await expect(
      restoredPage.getByRole("radio", { name: "PT-BR" })
    ).toBeChecked();
    await expect(restoredPage.locator("html")).toHaveAttribute("lang", "pt-BR");

    if (storedTheme === "dark") {
      await expect(restoredPage.locator("html")).toHaveClass(
        DARK_CLASS_PATTERN
      );
    } else {
      await expect(restoredPage.locator("html")).not.toHaveClass(
        DARK_CLASS_PATTERN
      );
    }

    const restoredBounds = await app.evaluate(({ BrowserWindow }) => {
      const [window] = BrowserWindow.getAllWindows();

      return window?.getBounds();
    });

    expect(restoredBounds).toMatchObject({ height: 700, width: 900 });
  } finally {
    await app.close().catch(() => undefined);
    removeTempDir(tempDir);
  }
});
