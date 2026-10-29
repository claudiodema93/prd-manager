import { z } from "zod";

export const customerStatusSchema = z.enum(["ok", "warning", "error"]);

export const customerFolderPathInputSchema = z.object({
  folderPath: z.string().min(1),
});

export const listCustomersInputSchema = z.object({
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
  search: z.string().trim().min(1).optional(),
  status: customerStatusSchema.optional(),
});

const nullableJsonSchema = z
  .string()
  .refine((value) => {
    try {
      JSON.parse(value);

      return true;
    } catch {
      return false;
    }
  }, "metadataJson must be valid JSON")
  .nullable()
  .optional();

export const upsertCustomerInputSchema = z.object({
  articleSchemaVersion: z.number().int().nullable().optional(),
  customerCode: z.string().min(1),
  folderMtimeMs: z.number().int(),
  folderName: z.string().min(1),
  folderPath: z.string().min(1),
  metadataJson: nullableJsonSchema,
  name: z.string().nullable().optional(),
  revisionSchemaVersion: z.number().int().nullable().optional(),
  schemaVersion: z.number().int().nullable().optional(),
  status: customerStatusSchema,
});
