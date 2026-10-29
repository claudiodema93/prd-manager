import { LOCAL_STORAGE_KEYS } from "@/constants";
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

// Mirrors the mode persisted in localStorage so the system-preference listener
// can ignore operating-system changes while the user chose an explicit mode.
let storedMode: ThemeMode | null = null;
let darkSchemeQuery: MediaQueryList | null = null;

export async function setTheme(newTheme: ThemeMode): Promise<ThemeState> {
  const state = await ipc.client.theme.setThemeMode({ mode: newTheme });

  persistThemeMode(newTheme);
  applyThemeState(state);

  return state;
}

export async function toggleTheme(): Promise<ThemeState> {
  const state = await ipc.client.theme.toggleThemeMode();

  // Toggling always produces an explicit source, never `system`.
  persistThemeMode(state.source);
  applyThemeState(state);

  return state;
}

export function syncWithLocalTheme(): Promise<ThemeState> {
  const local = readStoredMode();

  // An absent or unrecognised value falls back to following the OS, so a dark
  // system is rendered dark on first launch instead of always starting light.
  return setTheme(local ?? "system");
}

function readStoredMode(): ThemeMode | null {
  const value = localStorage.getItem(LOCAL_STORAGE_KEYS.THEME);

  return value !== null && isThemeMode(value) ? value : null;
}

function isThemeMode(value: string): value is ThemeMode {
  return (THEME_SOURCES as readonly string[]).includes(value);
}

function persistThemeMode(mode: ThemeMode) {
  storedMode = mode;
  localStorage.setItem(LOCAL_STORAGE_KEYS.THEME, mode);
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
