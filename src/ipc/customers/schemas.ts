import path from "node:path";
import { z } from "zod";
import { CUSTOMER_STATUSES } from "../../constants/customers";

const MAX_PATH_LENGTH = 4096;
const MAX_METADATA_DEPTH = 8;
const MAX_METADATA_NODES = 1000;
const MAX_METADATA_BYTES = 64 * 1024;

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

/**
 * Rejects metadata that is too large or too deeply nested to persist safely.
 * Returns a human-readable reason, or `null` when the value is acceptable.
 */
function findMetadataProblem(value: Record<string, unknown>): string | null {
  const seen = new WeakSet<object>();
  let nodes = 0;
  const stack: Array<{ depth: number; node: unknown }> = [
    { depth: 0, node: value },
  ];

  while (stack.length > 0) {
    const entry = stack.pop();

    if (!entry) {
      break;
    }

    const { depth, node } = entry;
    nodes += 1;

    if (nodes > MAX_METADATA_NODES) {
      return `metadataJson must contain at most ${MAX_METADATA_NODES} values.`;
    }

    if (depth > MAX_METADATA_DEPTH) {
      return `metadataJson must be at most ${MAX_METADATA_DEPTH} levels deep.`;
    }

    if (typeof node !== "object" || node === null) {
      continue;
    }

    if (seen.has(node)) {
      return "metadataJson must not contain circular references.";
    }

    seen.add(node);

    const children = Array.isArray(node)
      ? node
      : Object.values(node as Record<string, unknown>);

    for (const child of children) {
      stack.push({ depth: depth + 1, node: child });
    }
  }

  let serialized: string;

  try {
    serialized = JSON.stringify(value);
  } catch {
    return "metadataJson must be JSON-serialisable.";
  }

  if (Buffer.byteLength(serialized, "utf8") > MAX_METADATA_BYTES) {
    return `metadataJson must be at most ${MAX_METADATA_BYTES / 1024} KiB when serialised.`;
  }

  return null;
}

const metadataSchema = z
  .record(z.string(), z.unknown())
  .superRefine((value, context) => {
    const problem = findMetadataProblem(value);

    if (problem) {
      context.addIssue({ code: "custom", message: problem });
    }
  })
  .nullable()
  .optional();

export const upsertCustomerInputSchema = z
  .object({
    articleSchemaVersion: z.number().int().nonnegative().nullable().optional(),
    customerCode: z.string().trim().min(1).max(128),
    folderMtimeMs: z
      .number()
      .finite()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .transform(Math.trunc),
    folderName: z.string().trim().min(1).max(256),
    folderPath: customerPathSchema,
    metadataJson: metadataSchema,
    name: z
      .string()
      .trim()
      .max(256)
      .transform((value) => (value === "" ? null : value))
      .nullable()
      .optional(),
    revisionSchemaVersion: z.number().int().nonnegative().nullable().optional(),
    schemaVersion: z.number().int().nonnegative().nullable().optional(),
    status: customerStatusSchema,
  })
  .strict();

/**
 * Wire-format schemas. `createdAt`/`updatedAt` are epoch milliseconds, never
 * `Date`, because the message-port transport serialises responses as JSON.
 */
export const customerSummarySchema = z.object({
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
  metadataJson: z.record(z.string(), z.unknown()).nullable(),
});

export const listCustomersOutputSchema = z.object({
  items: z.array(customerSummarySchema),
  total: z.number().int().nonnegative(),
});

export const getCustomerOutputSchema = customerSchema.nullable();

export const upsertCustomerOutputSchema = customerSchema;

export const removeCustomerOutputSchema = z.string();

export const clearCustomersOutputSchema = z.number().int().nonnegative();
