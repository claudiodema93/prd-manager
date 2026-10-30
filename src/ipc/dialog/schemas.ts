import { z } from "zod";

const MAX_TEXT_LENGTH = 256;
const MAX_PATH_LENGTH = 4096;
const MAX_FILTERS = 20;
const MAX_FILTER_NAME_LENGTH = 64;
const MAX_EXTENSIONS = 50;
const MAX_EXTENSION_LENGTH = 16;
const MAX_SELECTED_PATHS = 10_000;

const EXTENSION_PATTERN = /^(?:\*|[A-Za-z0-9][A-Za-z0-9+_-]*)$/u;
const WILDCARD_PREFIX_PATTERN = /^\*\./u;
const LEADING_DOT_PATTERN = /^\./u;

const textSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_TEXT_LENGTH)
  .refine((value) => !value.includes("\u0000"), {
    message: "must not contain NUL characters",
  });

// A directory/file path may legitimately contain leading or trailing spaces,
// so it is deliberately not trimmed.
const defaultPathSchema = z
  .string()
  .min(1)
  .max(MAX_PATH_LENGTH)
  .refine((value) => !value.includes("\u0000"), {
    message: "defaultPath must not contain NUL characters",
  });

/**
 * Electron expects extensions without dots or wildcards: `png` is valid,
 * `.png` and `*.png` are not. Normalise the two common mistakes and reject
 * anything else.
 * Source: https://www.electronjs.org/docs/latest/api/dialog#dialogshowopendialogwindow-options
 */
function normalizeExtension(value: string): string {
  if (value === "*") {
    return "*";
  }

  return value
    .replace(WILDCARD_PREFIX_PATTERN, "")
    .replace(LEADING_DOT_PATTERN, "");
}

const extensionSchema = z
  .string()
  .trim()
  .min(1)
  .transform(normalizeExtension)
  .pipe(
    z
      .string()
      .min(1)
      .max(MAX_EXTENSION_LENGTH)
      .regex(
        EXTENSION_PATTERN,
        'extensions must be bare extensions, e.g. "png" or "*"'
      )
  );

export const fileFilterSchema = z
  .object({
    extensions: z.array(extensionSchema).min(1).max(MAX_EXTENSIONS),
    name: textSchema.max(MAX_FILTER_NAME_LENGTH),
  })
  .strict();

const commonDialogOptions = {
  buttonLabel: textSchema.optional(),
  defaultPath: defaultPathSchema.optional(),
  multiple: z.boolean().default(false),
  showHiddenFiles: z.boolean().default(false),
  title: textSchema.optional(),
};

export const openFileDialogInputSchema = z
  .object({
    ...commonDialogOptions,
    filters: z.array(fileFilterSchema).min(1).max(MAX_FILTERS).optional(),
  })
  .strict();

export const openDirectoryDialogInputSchema = z
  .object({
    ...commonDialogOptions,
  })
  .strict();

export const openDialogOutputSchema = z
  .object({
    canceled: z.boolean(),
    filePaths: z.array(z.string()).max(MAX_SELECTED_PATHS),
  })
  .strict();
