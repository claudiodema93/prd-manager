import { z } from "zod";
import { THEME_SOURCES } from "@/types/theme-mode";

export const themeSourceSchema = z.enum(THEME_SOURCES);

export const setThemeModeInputSchema = z
  .object({
    mode: themeSourceSchema,
  })
  .strict();

/**
 * Result of every theme procedure: the configured source plus the *effective*
 * dark state, which for `system` reflects the operating system preference.
 */
export const themeModeOutputSchema = z
  .object({
    dark: z.boolean(),
    source: themeSourceSchema,
  })
  .strict();
