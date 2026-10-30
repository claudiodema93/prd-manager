import { z } from "zod";
import { themeSourceSchema } from "@/ipc/theme/schemas";
import { LANGUAGE_KEYS } from "@/localization/langs";

export const languageSchema = z.enum(LANGUAGE_KEYS);

export const getPreferencesOutputSchema = z
  .object({
    language: languageSchema,
    sidebarOpen: z.boolean(),
    theme: themeSourceSchema,
  })
  .strict();

export const setLanguageInputSchema = z
  .object({
    language: languageSchema,
  })
  .strict();

export const setSidebarOpenInputSchema = z
  .object({
    open: z.boolean(),
  })
  .strict();
