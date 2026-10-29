import path from "node:path";
import { z } from "zod";
import { CUSTOMER_STATUSES } from "../../constants/customers";

const MAX_PATH_LENGTH = 4096;

export const customerStatusSchema = z.enum(CUSTOMER_STATUSES);

const customerPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_PATH_LENGTH)
  .transform((value) => path.resolve(value));

export const customerFolderPathInputSchema = z.object({
  folderPath: customerPathSchema,
});

export const listCustomersInputSchema = z.object({
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
  search: z
    .string()
    .trim()
    .max(256)
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
  status: customerStatusSchema.optional(),
});

const metadataSchema = z.record(z.string(), z.unknown()).nullable().optional();

export const upsertCustomerInputSchema = z.object({
  articleSchemaVersion: z.number().int().nonnegative().nullable().optional(),
  customerCode: z.string().trim().min(1).max(128),
  folderMtimeMs: z.number().finite().nonnegative().transform(Math.trunc),
  folderName: z.string().trim().min(1).max(256),
  folderPath: customerPathSchema,
  metadataJson: metadataSchema,
  name: z.string().trim().max(256).nullable().optional(),
  revisionSchemaVersion: z.number().int().nonnegative().nullable().optional(),
  schemaVersion: z.number().int().nonnegative().nullable().optional(),
  status: customerStatusSchema,
});
