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

// The search column stores the three user-visible values pre-folded to NFC and
// lower case, so `instr(search_text, ?)` matches non-ASCII text regardless of
// case or Unicode composition without a per-row JavaScript function.
function normalizeSearchText(
  customerCode: string,
  folderName: string,
  name: string | null
): string {
  return [customerCode, folderName, name ?? ""]
    .join(" ")
    .normalize("NFC")
    .toLocaleLowerCase();
}

export const listCustomers = os
  .input(listCustomersInputSchema)
  .output(listCustomersOutputSchema)
  .handler(({ input }) => {
    const db = getDatabase();
    const searchTerm = input.search?.normalize("NFC").toLocaleLowerCase();

    const where = and(
      input.status ? eq(customers.status, input.status) : undefined,
      searchTerm
        ? sql`instr(${customers.searchText}, ${searchTerm}) > 0`
        : undefined
    );

    const rows = db
      .select({
        ...customerSummaryColumns,
        // Window function: one scan returns the page and the full total.
        total: sql<number>`count(*) over ()`,
      })
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

    // `count(*) over ()` yields no rows when the offset is past the end, so the
    // total is only fetched separately for an empty page.
    const total =
      rows[0]?.total ??
      db.select({ total: count() }).from(customers).where(where).all()[0]
        ?.total ??
      0;

    const items = rows.map(({ total: _total, ...item }) => item);

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

    // A partial update keeps the stored name, so the search text must be built
    // from the value that will actually be persisted.
    const effectiveName =
      input.name === undefined
        ? (db
            .select({ name: customers.name })
            .from(customers)
            .where(eq(customers.folderPath, input.folderPath))
            .get()?.name ?? null)
        : input.name;
    const searchText = normalizeSearchText(
      input.customerCode,
      input.folderName,
      effectiveName
    );

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
      searchText,
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
      searchText,
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
