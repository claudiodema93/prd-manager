import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { CUSTOMER_STATUSES } from "../constants/customers";

export const customers = sqliteTable(
  "customers",
  {
    articleSchemaVersion: integer("article_schema_version"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`0`),
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
    status: text("status", { enum: CUSTOMER_STATUSES }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`0`),
  },
  (table) => [
    index("idx_customers_code_name").on(table.customerCode, table.folderName),
  ]
);
