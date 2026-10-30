import { os } from "@orpc/server";
import { nativeTheme } from "electron";
import {
  getLanguagePreference,
  getSidebarOpenPreference,
  setLanguagePreference,
  setSidebarOpenPreference,
} from "@/preferences/store";
import {
  getPreferencesOutputSchema,
  setLanguageInputSchema,
  setSidebarOpenInputSchema,
} from "./schemas";

/**
 * `nativeTheme.themeSource` is the main-process source of truth for the
 * three-state theme; the renderer only mirrors the resolved dark state.
 * Source: https://www.electronjs.org/docs/latest/api/native-theme#nativethemethemesource
 */
function currentPreferences() {
  return {
    language: getLanguagePreference(),
    sidebarOpen: getSidebarOpenPreference(),
    theme: nativeTheme.themeSource,
  };
}

export const getPreferences = os
  .output(getPreferencesOutputSchema)
  .handler(currentPreferences);

export const setLanguage = os
  .input(setLanguageInputSchema)
  .output(getPreferencesOutputSchema)
  .handler(({ input }) => {
    setLanguagePreference(input.language);

    return currentPreferences();
  });

export const setSidebarOpen = os
  .input(setSidebarOpenInputSchema)
  .output(getPreferencesOutputSchema)
  .handler(({ input }) => {
    setSidebarOpenPreference(input.open);

    return currentPreferences();
  });
