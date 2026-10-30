import { ipc } from "@/ipc/manager";
import type {
  CreateCustomerInput,
  ListCustomersInput,
  UpdateCustomerInput,
} from "@/types/customers";

export type {
  CreateCustomerInput,
  ListCustomersInput,
  UpdateCustomerInput,
} from "@/types/customers";

export function listCustomers(input: ListCustomersInput = {}) {
  return ipc.client.customers.listCustomers(input);
}

export function getCustomer(folderPath: string) {
  return ipc.client.customers.getCustomer({ folderPath });
}

export function createCustomer(input: CreateCustomerInput) {
  return ipc.client.customers.createCustomer(input);
}

export function updateCustomer(input: UpdateCustomerInput) {
  return ipc.client.customers.updateCustomer(input);
}

export function removeCustomer(folderPath: string) {
  return ipc.client.customers.removeCustomer({ folderPath });
}

export function scanCustomers() {
  return ipc.client.customers.scanCustomers({});
}

export function clearCustomers() {
  return ipc.client.customers.clearCustomers();
}
