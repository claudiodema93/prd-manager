import path from "node:path";
import type { Schema } from "electron-store";
import { z } from "zod";
import { LANGUAGE_KEYS, type LanguageKey } from "@/localization/langs";
import {
  DEFAULT_FOLDER_PREFERENCES,
  FOLDER_KEYS,
  type FolderPreferences,
} from "@/types/preferences";
import { THEME_SOURCES, type ThemeSource } from "@/types/theme-mode";

export const WINDOW_MIN_WIDTH = 400;
export const WINDOW_MIN_HEIGHT = 300;
export const MAX_DIRECTORY_PATH_LENGTH = 4096;

const MAX_WINDOW_DIMENSION = 10_000;
const MAX_WINDOW_COORDINATE = 100_000;

export interface WindowState {
  height: number;
  isMaximized: boolean;
  width: number;
  x?: number;
  y?: number;
}

export interface AppPreferences {
  folders: FolderPreferences;
  language: LanguageKey;
  theme: ThemeSource;
  window: WindowState;
}

export const DEFAULT_WINDOW_STATE: WindowState = {
  height: 600,
  isMaximized: false,
  width: 800,
};

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  folders: DEFAULT_FOLDER_PREFERENCES,
  language: "it",
  theme: "system",
  window: DEFAULT_WINDOW_STATE,
};

// Unknown keys are stripped rather than rejected: a preference added by a
// newer version must not discard every known value on a downgrade.
export const windowStateSchema = z.object({
  height: z.number().int().min(WINDOW_MIN_HEIGHT).max(MAX_WINDOW_DIMENSION),
  isMaximized: z.boolean(),
  width: z.number().int().min(WINDOW_MIN_WIDTH).max(MAX_WINDOW_DIMENSION),
  x: z
    .number()
    .int()
    .min(-MAX_WINDOW_COORDINATE)
    .max(MAX_WINDOW_COORDINATE)
    .optional(),
  y: z
    .number()
    .int()
    .min(-MAX_WINDOW_COORDINATE)
    .max(MAX_WINDOW_COORDINATE)
    .optional(),
});

// Same rule as the directory dialog: absolute, NUL-free, non-UNC paths only.
// Leading and trailing spaces are legitimate in a directory name, so the value
// is deliberately not trimmed.
export const directoryPreferenceSchema = z
  .string()
  .min(1)
  .max(MAX_DIRECTORY_PATH_LENGTH)
  .refine((value) => !value.includes("\u0000"), {
    message: "must not contain NUL characters",
  })
  .refine((value) => path.isAbsolute(value), {
    message: "must be absolute",
  })
  .refine((value) => !value.startsWith("\\\\"), {
    message: "UNC paths are not supported",
  })
  .nullable();

export const folderPreferencesSchema = z.object({
  articlesDirectory: directoryPreferenceSchema,
  issuesDirectory: directoryPreferenceSchema,
  trashDirectory: directoryPreferenceSchema,
});

export const appPreferencesSchema = z.object({
  folders: folderPreferencesSchema.default(DEFAULT_FOLDER_PREFERENCES),
  language: z.enum(LANGUAGE_KEYS),
  theme: z.enum(THEME_SOURCES),
  window: windowStateSchema,
});

/**
 * JSON Schema used by electron-store/conf to validate the file on read and
 * write. electron-store documents `schema` and `defaults` as the supported way
 * to keep a typed, validated store.
 * Source: https://github.com/sindresorhus/electron-store#schema
 */
export const PREFERENCES_JSON_SCHEMA: Schema<AppPreferences> = {
  folders: {
    default: DEFAULT_FOLDER_PREFERENCES,
    properties: {
      articlesDirectory: { default: null, type: ["string", "null"] },
      issuesDirectory: { default: null, type: ["string", "null"] },
      trashDirectory: { default: null, type: ["string", "null"] },
    },
    required: [...FOLDER_KEYS],
    type: "object",
  },
  language: {
    default: DEFAULT_APP_PREFERENCES.language,
    enum: [...LANGUAGE_KEYS],
    type: "string",
  },
  theme: {
    default: DEFAULT_APP_PREFERENCES.theme,
    enum: [...THEME_SOURCES],
    type: "string",
  },
  window: {
    default: DEFAULT_WINDOW_STATE,
    properties: {
      height: {
        maximum: MAX_WINDOW_DIMENSION,
        minimum: WINDOW_MIN_HEIGHT,
        type: "integer",
      },
      isMaximized: { default: false, type: "boolean" },
      width: {
        maximum: MAX_WINDOW_DIMENSION,
        minimum: WINDOW_MIN_WIDTH,
        type: "integer",
      },
      x: {
        maximum: MAX_WINDOW_COORDINATE,
        minimum: -MAX_WINDOW_COORDINATE,
        type: "integer",
      },
      y: {
        maximum: MAX_WINDOW_COORDINATE,
        minimum: -MAX_WINDOW_COORDINATE,
        type: "integer",
      },
    },
    required: ["height", "isMaximized", "width"],
    type: "object",
  },
};
