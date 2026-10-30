import { os } from "@orpc/server";
import { nativeTheme } from "electron";
import { setThemePreference } from "@/preferences/store";
import type { ThemeSource } from "@/types/theme-mode";
import { setThemeModeInputSchema, themeModeOutputSchema } from "./schemas";

interface ThemeModeState {
  dark: boolean;
  source: ThemeSource;
}

// `nativeTheme` updates synchronously when `themeSource` is assigned, so the
// effective dark state can be read back immediately after a change.
function currentThemeMode(): ThemeModeState {
  return {
    dark: nativeTheme.shouldUseDarkColors,
    source: nativeTheme.themeSource,
  };
}

export const getCurrentThemeMode = os
  .output(themeModeOutputSchema)
  .handler(() => currentThemeMode());

export const toggleThemeMode = os.output(themeModeOutputSchema).handler(() => {
  // Toggle the *effective* current appearance, so the first click on a dark
  // system selects light instead of re-selecting dark.
  nativeTheme.themeSource = nativeTheme.shouldUseDarkColors ? "light" : "dark";
  setThemePreference(nativeTheme.themeSource);

  return currentThemeMode();
});

export const setThemeMode = os
  .input(setThemeModeInputSchema)
  .output(themeModeOutputSchema)
  .handler(({ input }) => {
    nativeTheme.themeSource = input.mode;
    setThemePreference(input.mode);

    return currentThemeMode();
  });
