// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Store from "electron-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({
  isPackaged: false,
  userData: "",
}));

// electron-store destructures app/ipcMain/shell at import time and resolves its
// default directory through app.getPath("userData").
vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      if (name !== "userData") {
        throw new Error(`Unexpected app.getPath("${name}")`);
      }

      return electronState.userData;
    },
    getVersion: () => "1.4.1",
    get isPackaged() {
      return electronState.isPackaged;
    },
  },
  ipcMain: { on: vi.fn() },
  shell: { openPath: vi.fn(async () => "") },
}));

type StoreModule = typeof import("@/preferences/store");

const EXPECTED_DEFAULTS = {
  folders: {
    articlesDirectory: null,
    issuesDirectory: null,
    trashDirectory: null,
  },
  language: "it",
  theme: "system",
  window: { height: 600, isMaximized: false, width: 800 },
};

let tempDir: string;
let preferencesDir: string;
let storeModule: StoreModule | undefined;

async function loadStore(): Promise<StoreModule> {
  vi.resetModules();
  storeModule = await import("@/preferences/store");

  return storeModule;
}

function preferencesFile(): string {
  return path.join(preferencesDir, "preferences.json");
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "app-preferences-"));
  preferencesDir = path.join(tempDir, "preferences");
  electronState.userData = tempDir;
  electronState.isPackaged = false;
  process.env.APP_PREFERENCES_DIR = preferencesDir;
  delete process.env.APP_E2E;
});

afterEach(() => {
  storeModule?.resetPreferencesForTests();
  storeModule = undefined;
  delete process.env.APP_PREFERENCES_DIR;
  delete process.env.APP_E2E;
  electronState.isPackaged = false;
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { force: true, recursive: true });
});

describe("preferences store", () => {
  it("returns defaults before initialisation and ignores writes", async () => {
    const store = await loadStore();

    expect(store.getPreferences()).toEqual(EXPECTED_DEFAULTS);

    store.setThemePreference("dark");
    store.setLanguagePreference("it");

    expect(store.getPreferences()).toEqual(EXPECTED_DEFAULTS);
  });

  it("initialises with defaults and creates the JSON file", async () => {
    const store = await loadStore();
    store.initializePreferences();

    expect(store.getPreferences()).toEqual(EXPECTED_DEFAULTS);
    expect(store.getThemePreference()).toBe("system");
    expect(store.getLanguagePreference()).toBe("it");
    expect(fs.existsSync(preferencesFile())).toBe(true);
  });

  it("is idempotent", async () => {
    const store = await loadStore();
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    store.initializePreferences();
    store.initializePreferences();

    expect(error).not.toHaveBeenCalled();
  });

  it("persists theme, language and window state across instances", async () => {
    const store = await loadStore();
    store.initializePreferences();

    store.setThemePreference("dark");
    store.setLanguagePreference("it");
    store.setWindowState({
      height: 700,
      isMaximized: true,
      width: 900,
      x: 20,
      y: 30,
    });

    expect(store.getPreferences()).toEqual({
      folders: EXPECTED_DEFAULTS.folders,
      language: "it",
      theme: "dark",
      window: { height: 700, isMaximized: true, width: 900, x: 20, y: 30 },
    });

    store.resetPreferencesForTests();
    store.initializePreferences();

    expect(store.getPreferences()).toEqual({
      folders: EXPECTED_DEFAULTS.folders,
      language: "it",
      theme: "dark",
      window: { height: 700, isMaximized: true, width: 900, x: 20, y: 30 },
    });
  });

  it("persists folder preferences across instances", async () => {
    const store = await loadStore();
    store.initializePreferences();

    const articles = path.join(tempDir, "articles");
    const trash = path.join(tempDir, "trash");

    store.setFolderPreference("articlesDirectory", articles);
    store.setFolderPreference("trashDirectory", trash);

    expect(store.getFoldersPreference()).toEqual({
      articlesDirectory: articles,
      issuesDirectory: null,
      trashDirectory: trash,
    });

    store.resetPreferencesForTests();
    store.initializePreferences();

    expect(store.getFoldersPreference()).toEqual({
      articlesDirectory: articles,
      issuesDirectory: null,
      trashDirectory: trash,
    });
  });

  it("refuses to persist an invalid folder path and keeps the previous value", async () => {
    const store = await loadStore();
    store.initializePreferences();

    const articles = path.join(tempDir, "articles");
    store.setFolderPreference("articlesDirectory", articles);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    store.setFolderPreference("articlesDirectory", "relative/articles");

    expect(store.getFoldersPreference().articlesDirectory).toBe(articles);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("loads folder defaults from a legacy preferences file", async () => {
    fs.mkdirSync(preferencesDir, { recursive: true });
    fs.writeFileSync(
      preferencesFile(),
      JSON.stringify({
        language: "it",
        theme: "dark",
        window: { height: 600, isMaximized: false, width: 800 },
      })
    );

    const store = await loadStore();
    store.initializePreferences();

    expect(store.getPreferences()).toEqual({
      folders: EXPECTED_DEFAULTS.folders,
      language: "it",
      theme: "dark",
      window: EXPECTED_DEFAULTS.window,
    });
  });

  it("refuses to persist an invalid window state", async () => {
    const store = await loadStore();
    store.initializePreferences();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    store.setWindowState({ height: 1, isMaximized: false, width: 1 });

    expect(store.getWindowState()).toEqual(EXPECTED_DEFAULTS.window);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("falls back to defaults when the override directory is relative", async () => {
    process.env.APP_PREFERENCES_DIR = "relative/preferences";
    const store = await loadStore();
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    store.initializePreferences();

    expect(store.getPreferences()).toEqual(EXPECTED_DEFAULTS);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("recovers from a corrupt preferences file", async () => {
    fs.mkdirSync(preferencesDir, { recursive: true });
    fs.writeFileSync(preferencesFile(), "{not json");

    const store = await loadStore();
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    store.initializePreferences();

    // Recovery must go through clearInvalidConfig, not the failed-init
    // fallback: no error is logged and the file is rewritten with valid JSON.
    expect(error).not.toHaveBeenCalled();
    expect(store.getPreferences()).toEqual(EXPECTED_DEFAULTS);

    store.setThemePreference("dark");

    expect(
      (
        JSON.parse(fs.readFileSync(preferencesFile(), "utf8")) as {
          theme: string;
        }
      ).theme
    ).toBe("dark");
  });

  it.skipIf(process.platform === "win32")(
    "creates the preferences file with 0600 permissions",
    async () => {
      const store = await loadStore();
      store.initializePreferences();
      store.setThemePreference("dark");

      // biome-ignore lint/suspicious/noBitwiseOperators: POSIX permission bits
      expect(fs.statSync(preferencesFile()).mode & 0o777).toBe(0o600);
    }
  );

  it.skipIf(process.platform === "win32")(
    "refuses a symlinked preferences file without touching its target",
    async () => {
      fs.mkdirSync(preferencesDir, { recursive: true });
      const target = path.join(tempDir, "target.json");
      const contents = JSON.stringify(EXPECTED_DEFAULTS);

      fs.writeFileSync(target, contents);
      fs.symlinkSync(target, preferencesFile());

      const store = await loadStore();
      const error = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      store.initializePreferences();

      expect(store.getPreferences()).toEqual(EXPECTED_DEFAULTS);
      expect(fs.readFileSync(target, "utf8")).toBe(contents);
      expect(error).toHaveBeenCalledTimes(1);
    }
  );

  it("refuses an oversized preferences file", async () => {
    fs.mkdirSync(preferencesDir, { recursive: true });
    fs.writeFileSync(preferencesFile(), "x".repeat(64 * 1024 + 1));

    const store = await loadStore();
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    store.initializePreferences();

    expect(store.getPreferences()).toEqual(EXPECTED_DEFAULTS);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("refuses a non-regular preferences file", async () => {
    fs.mkdirSync(preferencesFile(), { recursive: true });

    const store = await loadStore();
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    store.initializePreferences();

    expect(store.getPreferences()).toEqual(EXPECTED_DEFAULTS);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("ignores the override in a packaged build unless APP_E2E is set", async () => {
    electronState.isPackaged = true;
    const store = await loadStore();
    store.initializePreferences();

    expect(fs.existsSync(path.join(tempDir, "preferences.json"))).toBe(true);
    expect(fs.existsSync(preferencesFile())).toBe(false);

    store.resetPreferencesForTests();
    process.env.APP_E2E = "1";

    const e2eStore = await loadStore();
    e2eStore.initializePreferences();

    expect(fs.existsSync(preferencesFile())).toBe(true);
  });

  it("swallows a failed write and keeps the previous value", async () => {
    const store = await loadStore();
    store.initializePreferences();
    store.setThemePreference("dark");

    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const set = vi.spyOn(Store.prototype, "set").mockImplementation(() => {
      throw new Error("disk full");
    });

    expect(() => store.setThemePreference("light")).not.toThrow();
    expect(store.getPreferences().theme).toBe("dark");
    expect(error).toHaveBeenCalledTimes(1);

    set.mockRestore();
  });

  it("falls back to defaults when reading the store throws", async () => {
    const store = await loadStore();
    store.initializePreferences();

    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const getter = vi
      .spyOn(Store.prototype, "store", "get")
      .mockImplementation(() => {
        throw new Error("read failed");
      });

    expect(store.getPreferences()).toEqual(EXPECTED_DEFAULTS);
    expect(error).toHaveBeenCalledTimes(1);

    getter.mockRestore();
  });
});
