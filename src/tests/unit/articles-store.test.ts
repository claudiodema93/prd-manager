// @vitest-environment node
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ArticleDatabase,
  deleteAllArticleRows,
  deleteArticleRow,
  deleteArticleRowsUnderCustomer,
  getArticleRow,
  listArticleRows,
  normalizeSearchText,
  upsertArticleRow,
} from "@/articles/store";
import type { ArticleCacheMetadata } from "@/articles/types";
import { articles, customers } from "@/db/schema";

const schema = { articles, customers };

type TestDatabase = ReturnType<typeof drizzle<typeof schema>>;

const CUSTOMER_PATH = path.resolve("/articles/customer-0001");

function metadata(
  overrides: Partial<ArticleCacheMetadata> = {}
): ArticleCacheMetadata {
  return {
    activeRevision: null,
    customer: 1,
    customParameters: {},
    parameters: { CODE: "a", EVO: "0" },
    schemaVersion: 1,
    ...overrides,
  };
}

function rowInput(
  overrides: {
    folderName?: string;
    folderPath?: string;
    customerFolderPath?: string;
    metadata?: ArticleCacheMetadata;
  } = {}
) {
  return {
    activeRevision: "REV_1",
    customerCode: "0001",
    customerFolderPath: overrides.customerFolderPath ?? CUSTOMER_PATH,
    folderMtimeMs: 123,
    folderName: overrides.folderName ?? "article-1",
    folderPath: overrides.folderPath ?? path.join(CUSTOMER_PATH, "article-1"),
    metadata: overrides.metadata ?? metadata(),
    revisionCount: 2,
    schemaVersion: 1,
  };
}

let sqlite: Database.Database;
let database: TestDatabase;

beforeEach(() => {
  sqlite = new Database(":memory:");
  database = drizzle({ client: sqlite, schema });
  migrate(database, {
    migrationsFolder: path.resolve(import.meta.dirname, "../../../drizzle"),
  });
});

afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
});

describe("normalizeSearchText", () => {
  it("folds NFC and lower-cases every value", () => {
    const text = normalizeSearchText(
      "Article-1",
      { CODE: "Café", EVO: "07" },
      { FLAG: true, NUM: 3 }
    );

    expect(text).toBe("article-1 café 07 true 3");
  });

  it("normalises decomposed input to NFC", () => {
    expect(normalizeSearchText("Café", {}, {})).toBe("café");
  });
});

describe("upsertArticleRow", () => {
  it("inserts a row with every cached column", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);

    const row = upsertArticleRow(database as ArticleDatabase, {
      ...rowInput(),
      metadata: metadata({
        activeRevision: "REV_1",
        customParameters: { FLAG: true },
        parameters: { CODE: "Café", EVO: "7" },
      }),
    });

    expect(row).toMatchObject({
      activeRevision: "REV_1",
      createdAt: 1000,
      customerCode: "0001",
      customerFolderPath: CUSTOMER_PATH,
      folderMtimeMs: 123,
      folderName: "article-1",
      folderPath: path.join(CUSTOMER_PATH, "article-1"),
      revisionCount: 2,
      schemaVersion: 1,
      searchText: "article-1 café 7 true",
      updatedAt: 1000,
    });
    expect(row.metadataJson).toMatchObject({
      activeRevision: "REV_1",
      customParameters: { FLAG: true },
      parameters: { CODE: "Café", EVO: "7" },
    });
  });

  it("updates an existing row while preserving createdAt", () => {
    const spy = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(2000);

    const first = upsertArticleRow(database as ArticleDatabase, rowInput());
    const second = upsertArticleRow(database as ArticleDatabase, {
      ...rowInput(),
      folderMtimeMs: 999,
      revisionCount: 7,
    });

    expect(first.createdAt).toBe(1000);
    expect(second.createdAt).toBe(1000);
    expect(second.updatedAt).toBe(2000);
    expect(second.folderMtimeMs).toBe(999);
    expect(second.revisionCount).toBe(7);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("accepts a null active revision", () => {
    const row = upsertArticleRow(database as ArticleDatabase, {
      ...rowInput(),
      activeRevision: null,
      metadata: metadata({ activeRevision: null }),
    });

    expect(row.activeRevision).toBeNull();
  });
});

describe("read helpers", () => {
  it("gets a cached row and returns null when missing", () => {
    const input = rowInput();
    const inserted = upsertArticleRow(database as ArticleDatabase, input);

    expect(
      getArticleRow(database as ArticleDatabase, inserted.folderPath)
    ).toMatchObject({ folderPath: inserted.folderPath });
    expect(getArticleRow(database as ArticleDatabase, "/missing")).toBeNull();
  });

  it("lists every row", () => {
    upsertArticleRow(database as ArticleDatabase, rowInput());
    upsertArticleRow(
      database as ArticleDatabase,
      rowInput({
        folderName: "article-2",
        folderPath: path.join(CUSTOMER_PATH, "article-2"),
      })
    );

    expect(listArticleRows(database as ArticleDatabase)).toHaveLength(2);
  });
});

describe("delete helpers", () => {
  it("deletes one row and reports the changed count", () => {
    const inserted = upsertArticleRow(database as ArticleDatabase, rowInput());

    expect(
      deleteArticleRow(database as ArticleDatabase, inserted.folderPath)
    ).toBe(1);
    expect(
      deleteArticleRow(database as ArticleDatabase, inserted.folderPath)
    ).toBe(0);
  });

  it("deletes every row", () => {
    upsertArticleRow(database as ArticleDatabase, rowInput());
    upsertArticleRow(
      database as ArticleDatabase,
      rowInput({
        folderName: "article-2",
        folderPath: path.join(CUSTOMER_PATH, "article-2"),
      })
    );

    expect(deleteAllArticleRows(database as ArticleDatabase)).toBe(2);
    expect(listArticleRows(database as ArticleDatabase)).toEqual([]);
  });

  it("deletes only the rows under one customer folder", () => {
    const otherCustomer = path.resolve("/articles/customer-0002");

    upsertArticleRow(database as ArticleDatabase, rowInput());
    upsertArticleRow(
      database as ArticleDatabase,
      rowInput({
        folderName: "article-2",
        folderPath: path.join(CUSTOMER_PATH, "article-2"),
      })
    );
    upsertArticleRow(
      database as ArticleDatabase,
      rowInput({
        customerFolderPath: otherCustomer,
        folderName: "article-1",
        folderPath: path.join(otherCustomer, "article-1"),
      })
    );

    expect(
      deleteArticleRowsUnderCustomer(database as ArticleDatabase, CUSTOMER_PATH)
    ).toBe(2);

    const remaining = listArticleRows(database as ArticleDatabase);

    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.customerFolderPath).toBe(otherCustomer);
  });
});
