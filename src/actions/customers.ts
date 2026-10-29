import type { z } from "zod";
import type {
  listCustomersInputSchema,
  upsertCustomerInputSchema,
} from "@/ipc/customers/schemas";
import { ipc } from "@/ipc/manager";

export type ListCustomersInput = z.input<typeof listCustomersInputSchema>;
export type UpsertCustomerInput = z.input<typeof upsertCustomerInputSchema>;

export function listCustomers(input: ListCustomersInput = {}) {
  return ipc.client.customers.list(input);
}

export function getCustomer(folderPath: string) {
  return ipc.client.customers.get({ folderPath });
}

export function upsertCustomer(input: UpsertCustomerInput) {
  return ipc.client.customers.upsert(input);
}

export function removeCustomer(folderPath: string) {
  return ipc.client.customers.remove({ folderPath });
}

export function clearCustomers() {
  return ipc.client.customers.clear();
}
