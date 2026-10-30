// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({ userData: "" }));

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
  },
  ipcMain: { on: vi.fn() },
  shell: { openPath: vi.fn(async () => "") },
}));

type StoreModule = typeof import("@/preferences/store");

const EXPECTED_DEFAULTS = {
  language: "en",
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

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "app-preferences-"));
  preferencesDir = path.join(tempDir, "preferences");
  electronState.userData = tempDir;
  process.env.APP_PREFERENCES_DIR = preferencesDir;
});

afterEach(() => {
  storeModule?.resetPreferencesForTests();
  storeModule = undefined;
  delete process.env.APP_PREFERENCES_DIR;
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { force: true, recursive: true });
});

describe("preferences store", () => {
  it("returns defaults before initialisation and ignores writes", async () => {
    const store = await loadStore();

    expect(store.getPreferences()).toEqual(EXPECTED_DEFAULTS);

    store.setThemePreference("dark");
    store.setLanguagePreference("pt-BR");

    expect(store.getPreferences()).toEqual(EXPECTED_DEFAULTS);
  });

  it("initialises with defaults and creates the JSON file", async () => {
    const store = await loadStore();
    store.initializePreferences();

    expect(store.getPreferences()).toEqual(EXPECTED_DEFAULTS);
    expect(fs.existsSync(path.join(preferencesDir, "preferences.json"))).toBe(
      true
    );
  });

  it("persists theme, language and window state across instances", async () => {
    const store = await loadStore();
    store.initializePreferences();

    store.setThemePreference("dark");
    store.setLanguagePreference("pt-BR");
    store.setWindowState({
      height: 700,
      isMaximized: true,
      width: 900,
      x: 20,
      y: 30,
    });

    expect(store.getPreferences()).toEqual({
      language: "pt-BR",
      theme: "dark",
      window: { height: 700, isMaximized: true, width: 900, x: 20, y: 30 },
    });

    store.resetPreferencesForTests();
    store.initializePreferences();

    expect(store.getPreferences()).toEqual({
      language: "pt-BR",
      theme: "dark",
      window: { height: 700, isMaximized: true, width: 900, x: 20, y: 30 },
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
    fs.writeFileSync(
      path.join(preferencesDir, "preferences.json"),
      "{not json"
    );

    const store = await loadStore();
    store.initializePreferences();

    expect(store.getPreferences()).toEqual(EXPECTED_DEFAULTS);
  });
});
