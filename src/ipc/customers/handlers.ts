import { ORPCError, os } from "@orpc/server";
import { and, count, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/db";
import { customers } from "@/db/schema";
import {
  customerFolderPathInputSchema,
  listCustomersInputSchema,
  upsertCustomerInputSchema,
} from "./schemas";

export const listCustomers = os
  .input(listCustomersInputSchema)
  .handler(({ input }) => {
    const db = getDatabase();
    const conditions = [
      input.status ? eq(customers.status, input.status) : undefined,
      input.search
        ? sql`instr(${customers.customerCode}, ${input.search}) > 0`
        : undefined,
    ].filter((condition) => condition !== undefined);

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const items = db
      .select()
      .from(customers)
      .where(where)
      .orderBy(customers.customerCode, customers.folderName)
      .limit(input.limit)
      .offset(input.offset)
      .all();

    const [{ total }] = db
      .select({ total: count() })
      .from(customers)
      .where(where)
      .all();

    return { items, total };
  });

export const getCustomer = os
  .input(customerFolderPathInputSchema)
  .handler(({ input }) => {
    const db = getDatabase();
    const [customer] = db
      .select()
      .from(customers)
      .where(eq(customers.folderPath, input.folderPath))
      .limit(1)
      .all();

    return customer ?? null;
  });

export const upsertCustomer = os
  .input(upsertCustomerInputSchema)
  .handler(({ input }) => {
    const db = getDatabase();
    // Insert needs every column, so omitted optional fields become NULL.
    const row = {
      articleSchemaVersion: input.articleSchemaVersion ?? null,
      customerCode: input.customerCode,
      folderMtimeMs: input.folderMtimeMs,
      folderName: input.folderName,
      folderPath: input.folderPath,
      metadataJson: input.metadataJson ?? null,
      name: input.name ?? null,
      revisionSchemaVersion: input.revisionSchemaVersion ?? null,
      schemaVersion: input.schemaVersion ?? null,
      status: input.status,
    };

    // Update uses patch semantics: an omitted optional field keeps its stored
    // value, while an explicit `null` clears it.
    const updates = {
      ...(input.articleSchemaVersion === undefined
        ? {}
        : { articleSchemaVersion: input.articleSchemaVersion }),
      customerCode: input.customerCode,
      folderMtimeMs: input.folderMtimeMs,
      folderName: input.folderName,
      ...(input.metadataJson === undefined
        ? {}
        : { metadataJson: input.metadataJson }),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.revisionSchemaVersion === undefined
        ? {}
        : { revisionSchemaVersion: input.revisionSchemaVersion }),
      ...(input.schemaVersion === undefined
        ? {}
        : { schemaVersion: input.schemaVersion }),
      status: input.status,
    };

    const [customer] = db
      .insert(customers)
      .values(row)
      .onConflictDoUpdate({ set: updates, target: customers.folderPath })
      .returning()
      .all();

    return customer;
  });

export const removeCustomer = os
  .input(customerFolderPathInputSchema)
  .handler(({ input }) => {
    const db = getDatabase();
    const [removed] = db
      .delete(customers)
      .where(eq(customers.folderPath, input.folderPath))
      .returning({ folderPath: customers.folderPath })
      .all();

    if (!removed) {
      throw new ORPCError("NOT_FOUND", {
        message: `No customer found for "${input.folderPath}".`,
      });
    }

    return removed.folderPath;
  });

export const clearCustomers = os.handler(() => {
  const db = getDatabase();
  const removed = db
    .delete(customers)
    .returning({ folderPath: customers.folderPath })
    .all();

  return removed.length;
});
