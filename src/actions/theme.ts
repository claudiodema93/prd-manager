import { ipc } from "@/ipc/manager";
import {
  THEME_SOURCES,
  type ThemeMode,
  type ThemeSource,
} from "@/types/theme-mode";

export interface ThemeState {
  dark: boolean;
  source: ThemeSource;
}

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

// Mirrors the mode persisted in electron-store so the system-preference
// listener can ignore operating-system changes while the user chose an
// explicit mode.
let storedMode: ThemeMode | null = null;
let darkSchemeQuery: MediaQueryList | null = null;

export async function setTheme(newTheme: ThemeMode): Promise<ThemeState> {
  const state = await ipc.client.theme.setThemeMode({ mode: newTheme });

  rememberThemeMode(newTheme);
  applyThemeState(state);

  return state;
}

export async function toggleTheme(): Promise<ThemeState> {
  const state = await ipc.client.theme.toggleThemeMode();

  // Toggling always produces an explicit source, never `system`.
  rememberThemeMode(state.source);
  applyThemeState(state);

  return state;
}

/**
 * Reads the theme configured in the main process without applying it; the
 * display page only needs the current source to render its selector.
 */
export function getThemeState(): Promise<ThemeState> {
  return ipc.client.theme.getCurrentThemeMode();
}

export async function syncTheme(): Promise<ThemeState> {
  // The main process already restored the stored theme before the window was
  // created, so the renderer only mirrors that state onto the document.
  const state = await ipc.client.theme.getCurrentThemeMode();

  rememberThemeMode(state.source);
  applyThemeState(state);

  return state;
}

function isThemeMode(value: string): value is ThemeMode {
  return (THEME_SOURCES as readonly string[]).includes(value);
}

function rememberThemeMode(mode: ThemeMode) {
  if (!isThemeMode(mode)) {
    return;
  }

  storedMode = mode;
}

function applyThemeState(state: ThemeState) {
  if (state.source !== "system") {
    applyDarkClass(state.dark);
    return;
  }

  // In system mode the renderer follows the media query, which is the only
  // signal that changes live when the OS preference changes.
  const query = getDarkSchemeQuery();
  applyDarkClass(query ? query.matches : state.dark);
}

function getDarkSchemeQuery(): MediaQueryList | null {
  if (typeof window.matchMedia !== "function") {
    return null;
  }

  if (!darkSchemeQuery) {
    darkSchemeQuery = window.matchMedia(DARK_SCHEME_QUERY);
    darkSchemeQuery.addEventListener("change", handleDarkSchemeChange);
  }

  return darkSchemeQuery;
}

function handleDarkSchemeChange(event: MediaQueryListEvent) {
  if (storedMode === "system") {
    applyDarkClass(event.matches);
  }
}

function applyDarkClass(isDark: boolean) {
  document.documentElement.classList.toggle("dark", isDark);
}
