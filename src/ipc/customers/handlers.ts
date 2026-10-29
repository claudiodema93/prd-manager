import { ORPCError, os } from "@orpc/server";
import { and, count, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/db";
import { customers } from "@/db/schema";
import {
  clearCustomersOutputSchema,
  customerFolderPathInputSchema,
  getCustomerOutputSchema,
  listCustomersInputSchema,
  listCustomersOutputSchema,
  removeCustomerOutputSchema,
  upsertCustomerInputSchema,
  upsertCustomerOutputSchema,
} from "./schemas";

type CustomersDatabase = ReturnType<typeof getDatabase>;

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

// SQLite's built-in `lower()` only folds ASCII, so non-ASCII names such as
// "MÜLLER GmbH" could not be matched. This registers a Unicode-aware function
// on each connection, and a WeakSet keeps the registration idempotent.
const cacheLowerConnections = new WeakSet<object>();

function registerCacheLower(db: CustomersDatabase): void {
  const client = db.$client;

  if (cacheLowerConnections.has(client)) {
    return;
  }

  client.function("cache_lower", { deterministic: true }, (value) =>
    typeof value === "string" ? value.toLocaleLowerCase() : value
  );
  cacheLowerConnections.add(client);
}

export const listCustomers = os
  .input(listCustomersInputSchema)
  .output(listCustomersOutputSchema)
  .handler(({ input }) => {
    const db = getDatabase();
    registerCacheLower(db);

    const searchPattern = input.search
      ? `%${escapeLikePattern(input.search.toLocaleLowerCase())}%`
      : undefined;

    const where = and(
      input.status ? eq(customers.status, input.status) : undefined,
      searchPattern
        ? sql`(
            cache_lower(${customers.customerCode}) LIKE ${searchPattern} ESCAPE '\\'
            OR cache_lower(${customers.folderName}) LIKE ${searchPattern} ESCAPE '\\'
            OR cache_lower(${customers.name}) LIKE ${searchPattern} ESCAPE '\\'
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
  .output(getCustomerOutputSchema)
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
  .output(upsertCustomerOutputSchema)
  .handler(({ input }) => {
    const db = getDatabase();
    const now = Date.now();

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
    // value, while an explicit `null` clears it. `createdAt` is never updated.
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
  .output(removeCustomerOutputSchema)
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

export const clearCustomers = os
  .output(clearCustomersOutputSchema)
  .handler(() => {
    const db = getDatabase();

    return db.delete(customers).run().changes;
  });

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}
