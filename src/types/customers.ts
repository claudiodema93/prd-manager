import type { z } from "zod";
import type {
  listCustomersInputSchema,
  upsertCustomerInputSchema,
} from "@/ipc/customers/schemas";

export type ListCustomersInput = z.input<typeof listCustomersInputSchema>;
export type UpsertCustomerInput = z.input<typeof upsertCustomerInputSchema>;
