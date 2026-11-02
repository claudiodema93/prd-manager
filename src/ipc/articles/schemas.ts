import path from "node:path";
import { z } from "zod";
import {
  ARTICLE_ISSUE_CODES,
  MAX_ARTICLE_ISSUE_MESSAGE_LENGTH,
} from "@/articles/types";

const MAX_PATH_LENGTH = 4096;
const MAX_PARAMETER_ENTRIES = 64;
const MAX_PARAMETER_VALUE_LENGTH = 1024;
const MAX_ACTIVE_REVISION_LENGTH = 255;
const MAX_SEARCH_LENGTH = 256;

/**
 * Every path crossing the IPC boundary is resolved here, exactly like the
 * customer schemas: a relative path would resolve differently in development
 * and packaged builds.
 */
const articlePathSchema = z
  .string()
  // Paths are filesystem data: do not trim, a leading/trailing space is part of
  // the directory name on macOS and Linux.
  .min(1)
  .max(MAX_PATH_LENGTH)
  .refine((value) => !value.includes("\u0000"), {
    message: "Path must not contain NUL characters.",
  })
  .transform((value) => path.resolve(value));

export const parameterNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/u, {
  message:
    "Parameter names must start with an uppercase letter and contain only uppercase letters, digits and underscores (1-64 characters).",
});

/** Declared and custom values accept the same JSON scalars. */
const articleParameterValueSchema = z.union([
  z.string().max(MAX_PARAMETER_VALUE_LENGTH),
  z.number(),
  z.boolean(),
]);

const articleParametersSchema = z
  .record(parameterNameSchema, articleParameterValueSchema)
  .refine((record) => Object.keys(record).length <= MAX_PARAMETER_ENTRIES, {
    message: `At most ${MAX_PARAMETER_ENTRIES} parameters are allowed.`,
  });

const declaredParameterValuesSchema = z.record(
  parameterNameSchema,
  z.string().max(MAX_PARAMETER_VALUE_LENGTH)
);

export const articleIssueSchema = z
  .object({
    code: z.enum(ARTICLE_ISSUE_CODES),
    message: z.string().min(1).max(MAX_ARTICLE_ISSUE_MESSAGE_LENGTH),
    path: z.string().max(MAX_PATH_LENGTH).optional(),
    severity: z.enum(["warning", "error"]),
  })
  .strict();

/**
 * Validates the document stored in `articles.metadata_json`. The stored column
 * is untyped JSON, so a legacy row must fail closed to `null` at the IPC
 * boundary instead of failing the whole response.
 */
export const articleCacheMetadataSchema = z
  .object({
    activeRevision: z
      .string()
      .min(1)
      .max(MAX_ACTIVE_REVISION_LENGTH)
      .nullable(),
    customer: z.number().int(),
    customParameters: articleParametersSchema,
    parameters: declaredParameterValuesSchema,
    schemaVersion: z.number().int().min(1),
  })
  .strict();

export const articleFolderPathInputSchema = z
  .object({
    folderPath: articlePathSchema,
  })
  .strict();

export const listArticlesInputSchema = z
  .object({
    customerFolderPath: articlePathSchema,
    limit: z.number().int().min(1).max(500).default(100),
    offset: z.number().int().min(0).default(0),
    search: z
      .string()
      .trim()
      .max(MAX_SEARCH_LENGTH)
      .optional()
      .transform((value) => (value === "" ? undefined : value)),
  })
  .strict();

export const createArticleInputSchema = z
  .object({
    customerFolderPath: articlePathSchema,
    customParameters: articleParametersSchema.optional(),
    parameters: articleParametersSchema,
  })
  .strict();

export const updateArticleInputSchema = z
  .object({
    customParameters: articleParametersSchema.optional(),
    folderPath: articlePathSchema,
    parameters: articleParametersSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.parameters !== undefined || value.customParameters !== undefined,
    {
      message: "At least one of parameters or customParameters is required.",
    }
  );

export const removeArticleInputSchema = articleFolderPathInputSchema;

export const scanArticlesInputSchema = z.object({}).strict();

/**
 * Wire-format schemas. `createdAt`/`updatedAt` are epoch milliseconds, never
 * `Date`, because the message-port transport serialises responses as JSON.
 */
export const articleSummarySchema = z.object({
  activeRevision: z.string().min(1).max(MAX_ACTIVE_REVISION_LENGTH).nullable(),
  createdAt: z.number().int().nonnegative(),
  customerCode: z.string(),
  customerFolderPath: z.string(),
  folderMtimeMs: z.number().int(),
  folderName: z.string(),
  folderPath: z.string(),
  revisionCount: z.number().int().nonnegative(),
  schemaVersion: z.number().int().min(1),
  updatedAt: z.number().int().nonnegative(),
});

export const articleSchema = articleSummarySchema.extend({
  metadataJson: articleCacheMetadataSchema.nullable(),
});

export const listArticlesOutputSchema = z.object({
  items: z.array(articleSummarySchema),
  total: z.number().int().nonnegative(),
});

export const getArticleOutputSchema = articleSchema.nullable();

export const createArticleOutputSchema = articleSchema;

export const updateArticleOutputSchema = articleSchema;

export const removeArticleOutputSchema = z.string();

export const clearArticlesOutputSchema = z.number().int().nonnegative();

export const scanArticlesOutputSchema = z
  .object({
    created: z.number().int().nonnegative(),
    issues: z.array(articleIssueSchema),
    removed: z.number().int().nonnegative(),
    root: z.string().nullable(),
    scanned: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
  })
  .strict();
