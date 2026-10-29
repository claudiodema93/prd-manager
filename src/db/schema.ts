import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const customers = sqliteTable(
  "customers",
  {
    articleSchemaVersion: integer("article_schema_version"),
    customerCode: text("customer_code").notNull(),
    folderMtimeMs: integer("folder_mtime_ms").notNull(),
    folderName: text("folder_name").notNull(),
    folderPath: text("folder_path").primaryKey(),
    metadataJson: text("metadata_json"),
    name: text("name"),
    revisionSchemaVersion: integer("revision_schema_version"),
    schemaVersion: integer("schema_version"),
    status: text("status", { enum: ["ok", "warning", "error"] }).notNull(),
  },
  (table) => [index("idx_customers_code").on(table.customerCode)]
);
