import path from "node:path";
import Store from "electron-store";
import type { LanguageKey } from "@/localization/langs";
import type { ThemeSource } from "@/types/theme-mode";
import {
  type AppPreferences,
  appPreferencesSchema,
  DEFAULT_APP_PREFERENCES,
  DEFAULT_WINDOW_STATE,
  PREFERENCES_JSON_SCHEMA,
  type WindowState,
  windowStateSchema,
} from "./schema";

const STORE_NAME = "preferences";
const PREFERENCES_DIR_ENV = "APP_PREFERENCES_DIR";

type PreferencesStore = Store<AppPreferences>;

let store: PreferencesStore | null = null;
let initializationFailed = false;

/**
 * Preferences only: electron-store rewrites the whole JSON file on every
 * change and its documentation warns against large datasets. The customer
 * cache stays in SQLite.
 * Source: https://github.com/sindresorhus/electron-store#faq
 */
function createStore(): PreferencesStore {
  const override = process.env[PREFERENCES_DIR_ENV]?.trim();
  let cwd: string | undefined;

  if (override) {
    if (!path.isAbsolute(override)) {
      throw new Error(
        `${PREFERENCES_DIR_ENV} must be an absolute path (received "${override}").`
      );
    }

    cwd = path.resolve(override);
  }

  return new Store<AppPreferences>({
    clearInvalidConfig: true,
    defaults: DEFAULT_APP_PREFERENCES,
    name: STORE_NAME,
    schema: PREFERENCES_JSON_SCHEMA,
    ...(cwd ? { cwd } : {}),
  });
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

/** Test seam: drops the cached instance so the next init re-reads the file. */
export function resetPreferencesForTests(): void {
  store = null;
  initializationFailed = false;
}
