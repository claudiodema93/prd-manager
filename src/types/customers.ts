import type { z } from "zod";
import type {
  createCustomerInputSchema,
  listCustomersInputSchema,
  scanCustomersInputSchema,
  updateCustomerInputSchema,
} from "@/ipc/customers/schemas";

export type CreateCustomerInput = z.input<typeof createCustomerInputSchema>;
export type UpdateCustomerInput = z.input<typeof updateCustomerInputSchema>;
export type ListCustomersInput = z.input<typeof listCustomersInputSchema>;
export type ScanCustomersInput = z.input<typeof scanCustomersInputSchema>;

export type {
  CustomerCacheMetadata,
  CustomerScanResult,
  CustomerSectionDefinition,
} from "@/customers/types";
