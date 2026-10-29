export const CUSTOMER_STATUSES = ["ok", "warning", "error"] as const;

export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];
