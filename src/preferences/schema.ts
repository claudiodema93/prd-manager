import type { Schema } from "electron-store";
import { z } from "zod";
import { LANGUAGE_KEYS, type LanguageKey } from "@/localization/langs";
import { THEME_SOURCES, type ThemeSource } from "@/types/theme-mode";

export const WINDOW_MIN_WIDTH = 400;
export const WINDOW_MIN_HEIGHT = 300;

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
  language: "en",
  theme: "system",
  window: DEFAULT_WINDOW_STATE,
};

export const windowStateSchema = z
  .object({
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
  })
  .strict();

export const appPreferencesSchema = z
  .object({
    language: z.enum(LANGUAGE_KEYS),
    theme: z.enum(THEME_SOURCES),
    window: windowStateSchema,
  })
  .strict();

/**
 * JSON Schema used by electron-store/conf to validate the file on read and
 * write. electron-store documents `schema` and `defaults` as the supported way
 * to keep a typed, validated store.
 * Source: https://github.com/sindresorhus/electron-store#schema
 */
export const PREFERENCES_JSON_SCHEMA: Schema<AppPreferences> = {
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
    additionalProperties: false,
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
