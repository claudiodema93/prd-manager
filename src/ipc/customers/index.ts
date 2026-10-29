import {
  clearCustomers,
  getCustomer,
  listCustomers,
  removeCustomer,
  upsertCustomer,
} from "./handlers";

export const customers = {
  clear: clearCustomers,
  get: getCustomer,
  list: listCustomers,
  remove: removeCustomer,
  upsert: upsertCustomer,
};
