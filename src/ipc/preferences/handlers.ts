import { os } from "@orpc/server";
import { nativeTheme } from "electron";
import {
  getLanguagePreference,
  setLanguagePreference,
} from "@/preferences/store";
import { getPreferencesOutputSchema, setLanguageInputSchema } from "./schemas";

/**
 * `nativeTheme.themeSource` is the main-process source of truth for the
 * three-state theme; the renderer only mirrors the resolved dark state.
 * Source: https://www.electronjs.org/docs/latest/api/native-theme#nativethemethemesource
 */
function currentPreferences() {
  return {
    language: getLanguagePreference(),
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
