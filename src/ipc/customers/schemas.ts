import path from "node:path";
import { z } from "zod";
import { CUSTOMER_STATUSES } from "@/constants/customers";
import { customerSectionDefinitionSchema } from "@/customers/config";
import { parseKeyTemplate } from "@/customers/key-template";
import {
  CUSTOMER_ISSUE_CODES,
  MAX_CUSTOMER_ISSUE_MESSAGE_LENGTH,
} from "@/customers/types";

const MAX_PATH_LENGTH = 4096;

export const customerStatusSchema = z.enum(CUSTOMER_STATUSES);

const customerPathSchema = z
  .string()
  // Paths are filesystem data: do not trim, a leading/trailing space is part of
  // the directory name on macOS and Linux.
  .min(1)
  .max(MAX_PATH_LENGTH)
  .refine((value) => !value.includes("\u0000"), {
    message: "folderPath must not contain NUL characters.",
  })
  .transform((value) => path.resolve(value));

/**
 * The section definition schema validates the structure; the key template is
 * parsed here as well so the IPC boundary also rejects a template that
 * references an undeclared parameter, lacks a placeholder, or misuses zero
 * padding.
 */
const customerSectionInputSchema = customerSectionDefinitionSchema.superRefine(
  (section, context) => {
    try {
      parseKeyTemplate(section.key, section.parameters);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : String(error),
        path: ["key"],
      });
    }
  }
);

export const customerIssueSchema = z
  .object({
    code: z.enum(CUSTOMER_ISSUE_CODES),
    message: z.string().min(1).max(MAX_CUSTOMER_ISSUE_MESSAGE_LENGTH),
    path: z.string().max(4096).optional(),
    severity: z.enum(["warning", "error"]),
  })
  .strict();

export const customerCacheMetadataSchema = z
  .object({
    article: customerSectionInputSchema.nullable(),
    articleCount: z.number().int().nonnegative(),
    issues: z.array(customerIssueSchema).max(200),
    revision: customerSectionInputSchema.nullable(),
  })
  .strict();

export const customerFolderPathInputSchema = z
  .object({
    folderPath: customerPathSchema,
  })
  .strict();

export const listCustomersInputSchema = z
  .object({
    limit: z.number().int().min(1).max(500).default(100),
    offset: z.number().int().min(0).default(0),
    search: z
      .string()
      .trim()
      .max(256)
      .optional()
      .transform((value) => (value === "" ? undefined : value)),
    status: customerStatusSchema.optional(),
  })
  .strict();

export const createCustomerInputSchema = z
  .object({
    article: customerSectionInputSchema,
    customerCode: z
      .string()
      .regex(/^\d{4}$/u)
      .refine((value) => value !== "0000", {
        message: "customerCode must be between 0001 and 9999.",
      })
      .optional(),
    name: z.string().trim().min(1).max(256),
    revision: customerSectionInputSchema,
  })
  .strict();

export const updateCustomerInputSchema = z
  .object({
    article: customerSectionInputSchema.optional(),
    folderPath: customerPathSchema,
    name: z.string().trim().min(1).max(256).optional(),
    revision: customerSectionInputSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.article !== undefined ||
      value.revision !== undefined,
    {
      message: "At least one of name, article or revision is required.",
    }
  );

export const scanCustomersInputSchema = z.object({}).strict();

/**
 * Wire-format schemas. `createdAt`/`updatedAt` are epoch milliseconds, never
 * `Date`, because the message-port transport serialises responses as JSON.
 */
export const customerSummarySchema = z.object({
  articleCount: z.number().int().nonnegative(),
  articleSchemaVersion: z.number().int().nullable(),
  createdAt: z.number().int().nonnegative(),
  customerCode: z.string(),
  folderMtimeMs: z.number().int(),
  folderName: z.string(),
  folderPath: z.string(),
  name: z.string().nullable(),
  revisionSchemaVersion: z.number().int().nullable(),
  schemaVersion: z.number().int().nullable(),
  status: customerStatusSchema,
  updatedAt: z.number().int().nonnegative(),
});

export const customerSchema = customerSummarySchema.extend({
  metadataJson: customerCacheMetadataSchema.nullable(),
});

export const listCustomersOutputSchema = z.object({
  items: z.array(customerSummarySchema),
  total: z.number().int().nonnegative(),
});

export const getCustomerOutputSchema = customerSchema.nullable();

export const createCustomerOutputSchema = customerSchema;

export const updateCustomerOutputSchema = customerSchema;

export const removeCustomerOutputSchema = z.string();

export const clearCustomersOutputSchema = z.number().int().nonnegative();

export const scanCustomersOutputSchema = z
  .object({
    created: z.number().int().nonnegative(),
    issues: z.array(customerIssueSchema),
    removed: z.number().int().nonnegative(),
    root: z.string().nullable(),
    scanned: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
  })
  .strict();
