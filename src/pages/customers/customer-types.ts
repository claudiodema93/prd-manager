import type { z } from "zod";
import type {
  customerSchema,
  customerSummarySchema,
} from "@/ipc/customers/schemas";

/**
 * Wire types for the customers UI.
 *
 * These are derived from the exported IPC schemas with *type-only* imports so
 * the renderer never pulls the main-process schema module (and its `node:path`
 * import) into the browser bundle at runtime.
 */
export type CustomerSummary = z.infer<typeof customerSummarySchema>;
export type Customer = z.infer<typeof customerSchema>;
export type CustomerMetadata = NonNullable<Customer["metadataJson"]>;
export type CustomerIssue = CustomerMetadata["issues"][number];
