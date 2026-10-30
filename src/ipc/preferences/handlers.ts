import { os } from "@orpc/server";
import { nativeTheme } from "electron";
import { withCustomerLock } from "@/customers/lock";
import { deleteAllCustomerRows } from "@/customers/store";
import {
  getFoldersPreference,
  getLanguagePreference,
  setFolderPreference,
  setLanguagePreference,
} from "@/preferences/store";
import {
  foldersOutputSchema,
  getPreferencesOutputSchema,
  setFolderInputSchema,
  setLanguageInputSchema,
} from "./schemas";

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

export const getFolders = os
  .output(foldersOutputSchema)
  .handler(() => getFoldersPreference());

export const setFolder = os
  .input(setFolderInputSchema)
  .output(foldersOutputSchema)
  .handler(async ({ input }) => {
    const previous = getFoldersPreference();

    setFolderPreference(input.key, input.directory);

    // The cache is keyed by absolute folder paths and the scanner only
    // reconciles rows under the current root. Changing the articles root must
    // therefore invalidate the old snapshot; the next scan repopulates it.
    if (
      input.key === "articlesDirectory" &&
      input.directory !== previous.articlesDirectory
    ) {
      try {
        const { getDatabase } = await import("@/db");

        await withCustomerLock(() =>
          Promise.resolve(deleteAllCustomerRows(getDatabase()))
        );
      } catch (error) {
        // The cache may not be initialised yet (tests, early startup); the
        // next scan reconciles it, so this is not fatal for the preference.
        console.warn(
          "[customers] Unable to clear the cache after changing the articles directory.",
          error
        );
      }
    }

    return getFoldersPreference();
  });
