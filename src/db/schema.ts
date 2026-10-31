import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { CUSTOMER_STATUSES } from "../constants/customers";

export const customers = sqliteTable(
  "customers",
  {
    articleSchemaVersion: integer("article_schema_version"),
    // Epoch milliseconds. Kept as plain integers because the IPC transport is
    // JSON, so Date instances would be silently downgraded to ISO strings.
    // `sql\`0\`` matches the existing migration snapshots (a literal `0` would
    // make drizzle-kit emit a no-op table rebuild).
    createdAt: integer("created_at").notNull().default(sql`0`),
    customerCode: text("customer_code").notNull(),
    folderMtimeMs: integer("folder_mtime_ms").notNull(),
    folderName: text("folder_name").notNull(),
    folderPath: text("folder_path").primaryKey(),
    metadataJson: text("metadata_json", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    name: text("name"),
    revisionSchemaVersion: integer("revision_schema_version"),
    schemaVersion: integer("schema_version"),
    // Pre-folded (NFC, lower-cased) concatenation of customer_code, folder_name
    // and name. Maintained by upsertCustomerRow so `instr()` searches never need a
    // per-row JavaScript function.
    searchText: text("search_text").notNull().default(""),
    status: text("status", { enum: CUSTOMER_STATUSES }).notNull(),
    updatedAt: integer("updated_at").notNull().default(sql`0`),
  },
  (table) => [
    index("idx_customers_code_name").on(table.customerCode, table.folderName),
  ]
);
