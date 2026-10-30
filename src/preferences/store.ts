import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import Store from "electron-store";
import type { LanguageKey } from "@/localization/langs";
import {
  DEFAULT_FOLDER_PREFERENCES,
  type FolderKey,
  type FolderPreferences,
} from "@/types/preferences";
import type { ThemeSource } from "@/types/theme-mode";
import {
  type AppPreferences,
  appPreferencesSchema,
  DEFAULT_APP_PREFERENCES,
  DEFAULT_WINDOW_STATE,
  folderPreferencesSchema,
  PREFERENCES_JSON_SCHEMA,
  type WindowState,
  windowStateSchema,
} from "./schema";

const STORE_NAME = "preferences";
const STORE_FILE = `${STORE_NAME}.json`;
const PREFERENCES_DIR_ENV = "APP_PREFERENCES_DIR";
const E2E_ENV = "APP_E2E";
const MAX_PREFERENCES_BYTES = 64 * 1024;

type PreferencesStore = Store<AppPreferences>;

let store: PreferencesStore | null = null;
let initializationFailed = false;

/**
 * In a packaged build the directory override is honoured only by the E2E
 * build, so a stray environment variable cannot redirect production data.
 * The e2e helper passes `APP_E2E=1` to the packaged app.
 */
function getOverrideDirectory(): string | undefined {
  if (app.isPackaged && process.env[E2E_ENV] !== "1") {
    return undefined;
  }

  const override = process.env[PREFERENCES_DIR_ENV]?.trim();

  if (!override) {
    return undefined;
  }

  if (!path.isAbsolute(override)) {
    throw new Error(
      `${PREFERENCES_DIR_ENV} must be an absolute path (received "${override}").`
    );
  }

  return path.resolve(override);
}

/**
 * Mirrors the cache DB's refusal rules: the store never writes through a
 * symlink and never opens a directory or a non-regular file.
 */
function assertSafeDirectory(directory: string): void {
  const stats = fs.lstatSync(directory, { throwIfNoEntry: false });

  if (stats?.isSymbolicLink()) {
    throw new Error(
      `Refusing to use "${directory}": it is a symbolic link. The path was not modified.`
    );
  }

  if (stats && !stats.isDirectory()) {
    throw new Error(
      `Refusing to use "${directory}": it is not a directory. The path was not modified.`
    );
  }

  if (!stats) {
    fs.mkdirSync(directory, { mode: 0o700, recursive: true });
  }
}

function assertSafeFile(file: string): void {
  const stats = fs.lstatSync(file, { throwIfNoEntry: false });

  if (!stats) {
    return;
  }

  if (stats.isSymbolicLink()) {
    throw new Error(
      `Refusing to use "${file}": it is a symbolic link. The path was not modified.`
    );
  }

  if (!stats.isFile()) {
    throw new Error(
      `Refusing to use "${file}": it is not a regular file. The path was not modified.`
    );
  }

  if (stats.size > MAX_PREFERENCES_BYTES) {
    throw new Error(
      `Refusing to use "${file}": it is larger than ${MAX_PREFERENCES_BYTES / 1024} KiB.`
    );
  }
}

function restrictFilePermissions(file: string): void {
  if (process.platform === "win32") {
    return;
  }

  try {
    fs.chmodSync(file, 0o600);
  } catch (error) {
    // The file may not exist until the first write.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(
        `[preferences] Could not restrict permissions on "${file}".`
      );
    }
  }
}

/**
 * Preferences only: electron-store rewrites the whole JSON file on every
 * change and its documentation warns against large datasets. The customer
 * cache stays in SQLite.
 * Source: https://github.com/sindresorhus/electron-store#faq
 */
function createStore(): PreferencesStore {
  const override = getOverrideDirectory();
  const cwd = override ?? app.getPath("userData");
  const file = path.join(cwd, STORE_FILE);

  assertSafeDirectory(cwd);
  assertSafeFile(file);

  const current = new Store<AppPreferences>({
    clearInvalidConfig: true,
    configFileMode: 0o600,
    cwd,
    defaults: DEFAULT_APP_PREFERENCES,
    name: STORE_NAME,
    schema: PREFERENCES_JSON_SCHEMA,
  });

  restrictFilePermissions(file);

  return current;
}

/**
 * Must run after `app.whenReady()`, because electron-store resolves the
 * default directory through `app.getPath("userData")`.
 * Source: https://www.electronjs.org/docs/latest/api/app#appwhenready
 */
export function initializePreferences(): void {
  if (store || initializationFailed) {
    return;
  }

  try {
    store = createStore();
  } catch (error) {
    initializationFailed = true;
    console.error(
      "[preferences] Unable to initialise the preferences store; using defaults.",
      error
    );
  }
}

function fallbackPreferences(): AppPreferences {
  return {
    ...DEFAULT_APP_PREFERENCES,
    folders: { ...DEFAULT_FOLDER_PREFERENCES },
    window: { ...DEFAULT_WINDOW_STATE },
  };
}

export function getPreferences(): AppPreferences {
  if (!store) {
    return fallbackPreferences();
  }

  try {
    const parsed = appPreferencesSchema.safeParse(store.store);

    return parsed.success ? parsed.data : fallbackPreferences();
  } catch (error) {
    console.error("[preferences] Unable to read the preferences store.", error);

    return fallbackPreferences();
  }
}

export function getThemePreference(): ThemeSource {
  return getPreferences().theme;
}

export function getLanguagePreference(): LanguageKey {
  return getPreferences().language;
}

export function getWindowState(): WindowState {
  return getPreferences().window;
}

export function getFoldersPreference(): FolderPreferences {
  return { ...getPreferences().folders };
}

/**
 * A failed write must never reject the IPC call that triggered it: the theme
 * or language has already been applied in memory, and the renderer should
 * still acknowledge the user's choice for this session.
 */
function writePreference(write: (current: PreferencesStore) => void): void {
  if (!store) {
    return;
  }

  try {
    write(store);
  } catch (error) {
    console.error("[preferences] Unable to persist a preference.", error);
  }
}

export function setThemePreference(theme: ThemeSource): void {
  writePreference((current) => current.set("theme", theme));
}

export function setLanguagePreference(language: LanguageKey): void {
  writePreference((current) => current.set("language", language));
}

export function setWindowState(window: WindowState): void {
  const parsed = windowStateSchema.safeParse(window);

  if (!parsed.success) {
    console.warn("[preferences] Refusing to persist an invalid window state.");
    return;
  }

  writePreference((current) => current.set("window", parsed.data));
}

export function setFolderPreference(
  key: FolderKey,
  directory: string | null
): void {
  const folders = { ...getPreferences().folders, [key]: directory };
  const parsed = folderPreferencesSchema.safeParse(folders);

  if (!parsed.success) {
    console.warn("[preferences] Refusing to persist an invalid folder path.");
    return;
  }

  writePreference((current) => current.set("folders", parsed.data));
}

/** Test seam: drops the cached instance so the next init re-reads the file. */
export function resetPreferencesForTests(): void {
  store = null;
  initializationFailed = false;
}
