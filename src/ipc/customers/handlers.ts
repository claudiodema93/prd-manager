import { ORPCError, os } from "@orpc/server";
import { and, count, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/db";
import { customers } from "@/db/schema";
import {
  customerFolderPathInputSchema,
  listCustomersInputSchema,
  upsertCustomerInputSchema,
} from "./schemas";

// List responses only need summary columns; metadata is fetched on demand.
const customerSummaryColumns = {
  articleSchemaVersion: customers.articleSchemaVersion,
  createdAt: customers.createdAt,
  customerCode: customers.customerCode,
  folderMtimeMs: customers.folderMtimeMs,
  folderName: customers.folderName,
  folderPath: customers.folderPath,
  name: customers.name,
  revisionSchemaVersion: customers.revisionSchemaVersion,
  schemaVersion: customers.schemaVersion,
  status: customers.status,
  updatedAt: customers.updatedAt,
};

export const listCustomers = os
  .input(listCustomersInputSchema)
  .handler(({ input }) => {
    const db = getDatabase();
    const searchPattern = input.search
      ? `%${escapeLikePattern(input.search.toLowerCase())}%`
      : undefined;

    const where = and(
      input.status ? eq(customers.status, input.status) : undefined,
      searchPattern
        ? sql`(
            lower(${customers.customerCode}) LIKE ${searchPattern} ESCAPE '\\'
            OR lower(${customers.folderName}) LIKE ${searchPattern} ESCAPE '\\'
            OR lower(${customers.name}) LIKE ${searchPattern} ESCAPE '\\'
          )`
        : undefined
    );

    const items = db
      .select(customerSummaryColumns)
      .from(customers)
      .where(where)
      .orderBy(
        customers.customerCode,
        customers.folderName,
        customers.folderPath
      )
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

// Lookups return `null` when the row does not exist; mutations throw NOT_FOUND.
export const getCustomer = os
  .input(customerFolderPathInputSchema)
  .handler(({ input }) => {
    const db = getDatabase();

    return (
      db
        .select()
        .from(customers)
        .where(eq(customers.folderPath, input.folderPath))
        .get() ?? null
    );
  });

export const upsertCustomer = os
  .input(upsertCustomerInputSchema)
  .handler(({ input }) => {
    const db = getDatabase();
    const now = new Date();

    // Insert needs every column, so omitted optional fields become NULL.
    const row = {
      articleSchemaVersion: input.articleSchemaVersion ?? null,
      createdAt: now,
      customerCode: input.customerCode,
      folderMtimeMs: input.folderMtimeMs,
      folderName: input.folderName,
      folderPath: input.folderPath,
      metadataJson: input.metadataJson ?? null,
      name: input.name ?? null,
      revisionSchemaVersion: input.revisionSchemaVersion ?? null,
      schemaVersion: input.schemaVersion ?? null,
      status: input.status,
      updatedAt: now,
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
      updatedAt: now,
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
    const result = db
      .delete(customers)
      .where(eq(customers.folderPath, input.folderPath))
      .run();

    if (result.changes === 0) {
      throw new ORPCError("NOT_FOUND", {
        message: `No customer found for "${input.folderPath}".`,
      });
    }

    return input.folderPath;
  });

export const clearCustomers = os.handler(() => {
  const db = getDatabase();

  return db.delete(customers).run().changes;
});

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}
