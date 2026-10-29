import { ipc } from "@/ipc/manager";
import type {
  ListCustomersInput,
  UpsertCustomerInput,
} from "@/types/customers";

export type {
  ListCustomersInput,
  UpsertCustomerInput,
} from "@/types/customers";

export function listCustomers(input: ListCustomersInput = {}) {
  return ipc.client.customers.listCustomers(input);
}

export function getCustomer(folderPath: string) {
  return ipc.client.customers.getCustomer({ folderPath });
}

export function upsertCustomer(input: UpsertCustomerInput) {
  return ipc.client.customers.upsertCustomer(input);
}

export function removeCustomer(folderPath: string) {
  return ipc.client.customers.removeCustomer({ folderPath });
}

export function clearCustomers() {
  return ipc.client.customers.clearCustomers();
}
