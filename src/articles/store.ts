import { eq } from "drizzle-orm";
import type { CacheDatabase } from "@/db";
import { articles } from "@/db/schema";
import type { ArticleCacheMetadata, ArticleCustomValue } from "./types";

export type ArticleRecord = typeof articles.$inferSelect;

/** The database handle the article service operates on. */
export type ArticleDatabase = CacheDatabase;

export interface UpsertArticleRowInput {
  readonly activeRevision: string | null;
  readonly customerCode: string;
  readonly customerFolderPath: string;
  readonly folderMtimeMs: number;
  readonly folderName: string;
  readonly folderPath: string;
  readonly metadata: ArticleCacheMetadata;
  readonly revisionCount: number;
  readonly schemaVersion: number;
}

/**
 * Pre-folded (NFC, lower-cased) concatenation of the folder name and every
 * declared/custom parameter value. Maintained here so `instr()` searches never
 * need a per-row JavaScript function.
 */
export function normalizeSearchText(
  folderName: string,
  parameters: Readonly<Record<string, string>>,
  customParameters: Readonly<Record<string, ArticleCustomValue>>
): string {
  return [
    folderName,
    ...Object.values(parameters),
    ...Object.values(customParameters).map((value) => String(value)),
  ]
    .join(" ")
    .normalize("NFC")
    .toLocaleLowerCase();
}

/**
 * Inserts or replaces an article row. The scanner is the source of truth, so
 * every cached column is overwritten; only `createdAt` is preserved on an
 * update.
 */
export function upsertArticleRow(
  db: ArticleDatabase,
  input: UpsertArticleRowInput
): ArticleRecord {
  const now = Date.now();
  const searchText = normalizeSearchText(
    input.folderName,
    input.metadata.parameters,
    input.metadata.customParameters
  );
  const metadataJson = input.metadata as unknown as Record<string, unknown>;
  const values = {
    activeRevision: input.activeRevision,
    createdAt: now,
    customerCode: input.customerCode,
    customerFolderPath: input.customerFolderPath,
    folderMtimeMs: input.folderMtimeMs,
    folderName: input.folderName,
    folderPath: input.folderPath,
    metadataJson,
    revisionCount: input.revisionCount,
    schemaVersion: input.schemaVersion,
    searchText,
    updatedAt: now,
  };

  const [row] = db
    .insert(articles)
    .values(values)
    .onConflictDoUpdate({
      set: {
        activeRevision: input.activeRevision,
        customerCode: input.customerCode,
        customerFolderPath: input.customerFolderPath,
        folderMtimeMs: input.folderMtimeMs,
        folderName: input.folderName,
        metadataJson,
        revisionCount: input.revisionCount,
        schemaVersion: input.schemaVersion,
        searchText,
        updatedAt: now,
      },
      target: articles.folderPath,
    })
    .returning()
    .all();

  if (!row) {
    throw new Error(
      `Failed to upsert the article row for "${input.folderPath}".`
    );
  }

  return row;
}

export function getArticleRow(
  db: ArticleDatabase,
  folderPath: string
): ArticleRecord | null {
  return (
    db
      .select()
      .from(articles)
      .where(eq(articles.folderPath, folderPath))
      .get() ?? null
  );
}

export function deleteArticleRow(
  db: ArticleDatabase,
  folderPath: string
): number {
  return db.delete(articles).where(eq(articles.folderPath, folderPath)).run()
    .changes;
}

export function deleteAllArticleRows(db: ArticleDatabase): number {
  return db.delete(articles).run().changes;
}

export function listArticleRows(db: ArticleDatabase): ArticleRecord[] {
  return db.select().from(articles).all();
}

/** Deletes every cached article that belongs to the given customer folder. */
export function deleteArticleRowsUnderCustomer(
  db: ArticleDatabase,
  customerFolderPath: string
): number {
  return db
    .delete(articles)
    .where(eq(articles.customerFolderPath, customerFolderPath))
    .run().changes;
}
