import { eq } from "drizzle-orm";
import type { CacheDatabase } from "@/db";
import { customers } from "@/db/schema";
import type { CustomerCacheMetadata, CustomerIssue } from "./types";

export type CustomerRecord = typeof customers.$inferSelect;

export type CustomerRowStatus = CustomerRecord["status"];

/** The database handle the customer service operates on. */
export type CustomerDatabase = CacheDatabase;

export interface UpsertCustomerRowInput {
  readonly articleSchemaVersion: number | null;
  readonly customerCode: string;
  readonly folderMtimeMs: number;
  readonly folderName: string;
  readonly folderPath: string;
  /**
   * Mirrors the issues already carried by `metadata`; kept for call-site
   * symmetry. The row persists them inside `metadata_json` only.
   */
  readonly issues: readonly CustomerIssue[];
  readonly metadata: CustomerCacheMetadata;
  readonly name: string | null;
  readonly revisionSchemaVersion: number | null;
  readonly schemaVersion: number | null;
  readonly status: CustomerRowStatus;
}

/**
 * Pre-folded (NFC, lower-cased) concatenation of customer_code, folder_name
 * and name. Maintained here so `instr()` searches never need a per-row
 * JavaScript function.
 */
export function normalizeSearchText(
  customerCode: string,
  folderName: string,
  name: string | null
): string {
  return [customerCode, folderName, name ?? ""]
    .join(" ")
    .normalize("NFC")
    .toLocaleLowerCase();
}

/**
 * Inserts or replaces a customer row. The scanner is the source of truth, so
 * every cached column is overwritten; only `createdAt` is preserved on an
 * update.
 */
export function upsertCustomerRow(
  db: CacheDatabase,
  input: UpsertCustomerRowInput
): CustomerRecord {
  const now = Date.now();
  const searchText = normalizeSearchText(
    input.customerCode,
    input.folderName,
    input.name
  );
  const metadataJson = input.metadata as unknown as Record<string, unknown>;

  const [row] = db
    .insert(customers)
    .values({
      articleSchemaVersion: input.articleSchemaVersion,
      createdAt: now,
      customerCode: input.customerCode,
      folderMtimeMs: input.folderMtimeMs,
      folderName: input.folderName,
      folderPath: input.folderPath,
      metadataJson,
      name: input.name,
      revisionSchemaVersion: input.revisionSchemaVersion,
      schemaVersion: input.schemaVersion,
      searchText,
      status: input.status,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: {
        articleSchemaVersion: input.articleSchemaVersion,
        customerCode: input.customerCode,
        folderMtimeMs: input.folderMtimeMs,
        folderName: input.folderName,
        metadataJson,
        name: input.name,
        revisionSchemaVersion: input.revisionSchemaVersion,
        schemaVersion: input.schemaVersion,
        searchText,
        status: input.status,
        updatedAt: now,
      },
      target: customers.folderPath,
    })
    .returning()
    .all();

  if (!row) {
    throw new Error(
      `Failed to upsert the customer row for "${input.folderPath}".`
    );
  }

  return row;
}

export function getCustomerRow(
  db: CacheDatabase,
  folderPath: string
): CustomerRecord | null {
  return (
    db
      .select()
      .from(customers)
      .where(eq(customers.folderPath, folderPath))
      .get() ?? null
  );
}

export function deleteCustomerRow(
  db: CacheDatabase,
  folderPath: string
): number {
  return db.delete(customers).where(eq(customers.folderPath, folderPath)).run()
    .changes;
}

export function deleteAllCustomerRows(db: CacheDatabase): number {
  return db.delete(customers).run().changes;
}

export function listCustomerRows(db: CacheDatabase): CustomerRecord[] {
  return db.select().from(customers).all();
}
