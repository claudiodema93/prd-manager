import { ORPCError, os } from "@orpc/server";
import { and, count, eq, sql } from "drizzle-orm";
import {
  type ArticleServiceContext,
  createArticle as createArticleService,
  removeArticle as removeArticleService,
  updateArticle as updateArticleService,
} from "@/articles/crud";
import { type ArticleErrorCode, ArticleServiceError } from "@/articles/errors";
import { scanArticles as scanArticlesService } from "@/articles/scan";
import { type ArticleRecord, deleteAllArticleRows } from "@/articles/store";
import { withCustomerLock } from "@/customers/lock";
import { getDatabase } from "@/db";
import { articles } from "@/db/schema";
import { getFoldersPreference } from "@/preferences/store";
import {
  articleCacheMetadataSchema,
  articleFolderPathInputSchema,
  clearArticlesOutputSchema,
  createArticleInputSchema,
  createArticleOutputSchema,
  getArticleOutputSchema,
  listArticlesInputSchema,
  listArticlesOutputSchema,
  removeArticleInputSchema,
  removeArticleOutputSchema,
  scanArticlesInputSchema,
  scanArticlesOutputSchema,
  updateArticleInputSchema,
  updateArticleOutputSchema,
} from "./schemas";

// List responses only need summary columns; metadata is fetched on demand.
const articleSummaryColumns = {
  activeRevision: articles.activeRevision,
  createdAt: articles.createdAt,
  customerCode: articles.customerCode,
  customerFolderPath: articles.customerFolderPath,
  folderMtimeMs: articles.folderMtimeMs,
  folderName: articles.folderName,
  folderPath: articles.folderPath,
  revisionCount: articles.revisionCount,
  schemaVersion: articles.schemaVersion,
  updatedAt: articles.updatedAt,
};

const NOT_FOUND_ERROR_CODES: ReadonlySet<ArticleErrorCode> = new Set([
  "ARTICLE_CUSTOMER_NOT_FOUND",
  "ARTICLE_NOT_FOUND",
]);

const CONFLICT_ERROR_CODES: ReadonlySet<ArticleErrorCode> = new Set([
  "ARTICLE_ALREADY_EXISTS",
  "ARTICLE_KEY_LOCKED",
]);

const PRECONDITION_ERROR_CODES: ReadonlySet<ArticleErrorCode> = new Set([
  "ROOT_NOT_CONFIGURED",
  "ROOT_NOT_DIRECTORY",
  "ROOT_NOT_FOUND",
  "ROOT_SYMLINK",
  "TRASH_NOT_CONFIGURED",
  "TRASH_NOT_DIRECTORY",
  "TRASH_NOT_FOUND",
  "TRASH_SYMLINK",
]);

const BAD_REQUEST_ERROR_CODES: ReadonlySet<ArticleErrorCode> = new Set([
  "ARTICLE_CUSTOMER_CONFIG_INVALID",
  "ARTICLE_CUSTOMER_CONFIG_MISSING",
  "ARTICLE_CUSTOMER_NOT_DIRECTORY",
  "ARTICLE_CUSTOMER_SYMLINK",
  "ARTICLE_DATA_INVALID",
  "ARTICLE_DATA_INVALID_JSON",
  "ARTICLE_DATA_MISSING",
  "ARTICLE_DATA_UNREADABLE",
  "ARTICLE_FOLDER_NAME_INVALID",
  "ARTICLE_FOLDER_NOT_DIRECTORY",
  "ARTICLE_FOLDER_SYMLINK",
  "ARTICLE_PATH_INVALID",
  "INVALID_OPERATION",
  "KEY_RENDER_INVALID",
]);

/**
 * Translates a domain error into the oRPC status the renderer expects.
 *
 * `READ_FAILED`, `WRITE_FAILED` and `TRASH_MOVE_FAILED` are deliberately not
 * mapped: they are unexpected and must keep their original class so the
 * interceptor logs them as real 5xx failures.
 */
function mapArticleError(error: unknown): never {
  if (error instanceof ArticleServiceError) {
    if (NOT_FOUND_ERROR_CODES.has(error.code)) {
      throw new ORPCError("NOT_FOUND", { message: error.message });
    }

    if (CONFLICT_ERROR_CODES.has(error.code)) {
      throw new ORPCError("CONFLICT", { message: error.message });
    }

    if (PRECONDITION_ERROR_CODES.has(error.code)) {
      throw new ORPCError("PRECONDITION_FAILED", { message: error.message });
    }

    if (BAD_REQUEST_ERROR_CODES.has(error.code)) {
      throw new ORPCError("BAD_REQUEST", { message: error.message });
    }
  }

  throw error;
}

function articleServiceContext(): ArticleServiceContext {
  const folders = getFoldersPreference();

  return {
    articlesDirectory: folders.articlesDirectory,
    db: getDatabase(),
    trashDirectory: folders.trashDirectory,
  };
}

/**
 * Normalises the cached metadata so the result satisfies the wire schema.
 * Legacy rows may still hold an arbitrary metadata document; normalising it
 * here keeps the caller working instead of failing the whole response.
 */
function articleOutput(record: ArticleRecord) {
  const metadata = articleCacheMetadataSchema.safeParse(record.metadataJson);
  // `searchText` is a cache-internal column and must not cross the IPC wire.
  const { searchText: _searchText, ...wire } = record;

  return {
    ...wire,
    metadataJson: metadata.success ? metadata.data : null,
  };
}

export const listArticles = os
  .input(listArticlesInputSchema)
  .output(listArticlesOutputSchema)
  .handler(({ input }) => {
    const db = getDatabase();
    const searchTerm = input.search?.normalize("NFC").toLocaleLowerCase();

    const where = and(
      eq(articles.customerFolderPath, input.customerFolderPath),
      searchTerm
        ? sql`instr(${articles.searchText}, ${searchTerm}) > 0`
        : undefined
    );

    const rows = db
      .select({
        ...articleSummaryColumns,
        // Window function: one scan returns the page and the full total.
        total: sql<number>`count(*) over ()`,
      })
      .from(articles)
      .where(where)
      .orderBy(articles.folderName, articles.folderPath)
      .limit(input.limit)
      .offset(input.offset)
      .all();

    // `count(*) over ()` yields no rows when the offset is past the end, so the
    // total is only fetched separately for an empty page.
    const total =
      rows[0]?.total ??
      db.select({ total: count() }).from(articles).where(where).all()[0]
        ?.total ??
      0;

    const items = rows.map(({ total: _total, ...item }) => item);

    return { items, total };
  });

// Lookups return `null` when the row does not exist; mutations throw NOT_FOUND.
export const getArticle = os
  .input(articleFolderPathInputSchema)
  .output(getArticleOutputSchema)
  .handler(({ input }) => {
    const row =
      getDatabase()
        .select()
        .from(articles)
        .where(eq(articles.folderPath, input.folderPath))
        .get() ?? null;

    if (!row) {
      return null;
    }

    return articleOutput(row);
  });

export const scanArticles = os
  .input(scanArticlesInputSchema)
  .output(scanArticlesOutputSchema)
  .handler(async () => {
    try {
      const { articlesDirectory } = getFoldersPreference();

      return await scanArticlesService({
        db: getDatabase(),
        rootDirectory: articlesDirectory,
      });
    } catch (error) {
      throw mapArticleError(error);
    }
  });

export const createArticle = os
  .input(createArticleInputSchema)
  .output(createArticleOutputSchema)
  .handler(async ({ input }) => {
    try {
      const article = await createArticleService(
        articleServiceContext(),
        input
      );

      return articleOutput(article);
    } catch (error) {
      throw mapArticleError(error);
    }
  });

export const updateArticle = os
  .input(updateArticleInputSchema)
  .output(updateArticleOutputSchema)
  .handler(async ({ input }) => {
    try {
      const article = await updateArticleService(
        articleServiceContext(),
        input
      );

      return articleOutput(article);
    } catch (error) {
      throw mapArticleError(error);
    }
  });

export const removeArticle = os
  .input(removeArticleInputSchema)
  .output(removeArticleOutputSchema)
  .handler(async ({ input }) => {
    try {
      return await removeArticleService(articleServiceContext(), input);
    } catch (error) {
      throw mapArticleError(error);
    }
  });

// Cache-only reset: the filesystem is the source of truth and is never touched.
// It shares the customer lock so a clear cannot interleave with a scan that is
// repopulating the cache.
export const clearArticles = os
  .output(clearArticlesOutputSchema)
  .handler(() =>
    withCustomerLock(async () => deleteAllArticleRows(getDatabase()))
  );
