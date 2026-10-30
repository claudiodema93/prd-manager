import { z } from "zod";
import { themeSourceSchema } from "@/ipc/theme/schemas";
import { LANGUAGE_KEYS } from "@/localization/langs";
import {
  directoryPreferenceSchema,
  folderPreferencesSchema,
} from "@/preferences/schema";
import { FOLDER_KEYS } from "@/types/preferences";

export const languageSchema = z.enum(LANGUAGE_KEYS);

export const folderKeySchema = z.enum(FOLDER_KEYS);

export const foldersOutputSchema = folderPreferencesSchema.strict();

export const setFolderInputSchema = z
  .object({
    directory: directoryPreferenceSchema,
    key: folderKeySchema,
  })
  .strict();

export const getPreferencesOutputSchema = z
  .object({
    language: languageSchema,
    theme: themeSourceSchema,
  })
  .strict();

export const setLanguageInputSchema = z
  .object({
    language: languageSchema,
  })
  .strict();
