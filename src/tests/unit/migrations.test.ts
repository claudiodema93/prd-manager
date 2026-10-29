// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { customers } from "@/db/schema";

/**
 * The migrations are the source of truth for the on-disk shape of the cache.
 * These tests apply them to a real SQLite database so drift between
 * `drizzle/` and `src/db/schema.ts` fails loudly instead of at runtime.
 */

const migrationsFolder = path.resolve(import.meta.dirname, "../../../drizzle");

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

interface TableInfoRow {
  name: string;
  type: string;
}

interface IndexListRow {
  name: string;
  origin: string;
}

function readJournal(): Journal {
  const contents = fs.readFileSync(
    path.join(migrationsFolder, "meta", "_journal.json"),
    "utf8"
  );

  return JSON.parse(contents) as Journal;
}

function readMigrationTags(): string[] {
  return fs
    .readdirSync(migrationsFolder)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => path.basename(file, ".sql"))
    .sort();
}

function migrateInMemory() {
  const sqlite = new Database(":memory:");
  const db = drizzle({ client: sqlite, schema: { customers } });

  migrate(db, { migrationsFolder });

  return sqlite;
}

describe("drizzle migrations", () => {
  it("journals every migration with contiguous indices", () => {
    const { entries } = readJournal();
    const sorted = [...entries].sort((a, b) => a.idx - b.idx);

    expect(sorted.map((entry) => entry.idx)).toEqual(
      sorted.map((_, index) => index)
    );
    expect(sorted.map((entry) => entry.tag)).toEqual(readMigrationTags());
  });

  it("creates exactly the customer columns declared in the schema", () => {
    const sqlite = migrateInMemory();

    try {
      const migratedColumns = sqlite.pragma(
        "table_info(customers)"
      ) as TableInfoRow[];
      const actual = Object.fromEntries(
        migratedColumns
          .map((column) => [column.name, column.type.toLowerCase()])
          .sort(([a], [b]) => a.localeCompare(b))
      );
      const expected = Object.fromEntries(
        Object.values(getTableColumns(customers))
          .map((column) => [column.name, column.getSQLType().toLowerCase()])
          .sort(([a], [b]) => a.localeCompare(b))
      );

      expect(actual).toEqual(expected);
    } finally {
      sqlite.close();
    }
  });

  it("creates the composite customer index and nothing else", () => {
    const sqlite = migrateInMemory();

    try {
      const indexes = sqlite.pragma("index_list(customers)") as IndexListRow[];
      // `origin === "c"` selects indexes created by CREATE INDEX; primary-key
      // and UNIQUE autoindexes are reported separately.
      const createdIndexes = indexes
        .filter((index) => index.origin === "c")
        .map((index) => index.name)
        .sort();

      expect(createdIndexes).toEqual(["idx_customers_code_name"]);
    } finally {
      sqlite.close();
    }
  });
});
