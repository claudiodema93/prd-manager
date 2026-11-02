/**
 * Shared article-domain types and contracts.
 *
 * This module has no Electron or filesystem imports so the article service can
 * be unit-tested in isolation and reused by the main process without pulling in
 * the renderer.
 */

export const ARTICLE_ISSUE_CODES = [
  "ARTICLE_DATA_INVALID",
  "ARTICLE_DATA_INVALID_JSON",
  "ARTICLE_DATA_MISSING",
  "ARTICLE_DATA_UNREADABLE",
  "ARTICLE_FOLDER_NOT_DIRECTORY",
  "ARTICLE_FOLDER_SYMLINK",
  "CUSTOMER_CONFIG_INVALID",
  "CUSTOMER_CONFIG_INVALID_JSON",
  "CUSTOMER_CONFIG_MISSING",
  "CUSTOMER_CONFIG_UNREADABLE",
  "CUSTOMER_FOLDER_NOT_DIRECTORY",
  "CUSTOMER_FOLDER_SYMLINK",
  "ENTRY_UNEXPECTED",
  "ROOT_MISSING",
  "ROOT_NOT_DIRECTORY",
  "ROOT_SYMLINK",
  "ROOT_UNREADABLE",
] as const;

export type ArticleIssueCode = (typeof ARTICLE_ISSUE_CODES)[number];

export type ArticleIssueSeverity = "warning" | "error";

/** Issue messages are cached and validated at the IPC boundary. */
export const MAX_ARTICLE_ISSUE_MESSAGE_LENGTH = 1024;

/**
 * A non-fatal problem found while scanning one article or customer folder.
 * Article scans mirror the customer issue shape so the two can be surfaced
 * through the same scan-issues list.
 */
export interface ArticleIssue {
  readonly code: ArticleIssueCode;
  readonly message: string;
  readonly path?: string;
  readonly severity: ArticleIssueSeverity;
}

/**
 * A custom parameter value stored in `article_data.json`. Declared parameters
 * are always canonical strings; custom parameters preserve their JSON scalar.
 */
export type ArticleCustomValue = string | number | boolean;

/**
 * The shape stored in the `articles.metadata_json` column.
 */
export interface ArticleCacheMetadata {
  readonly activeRevision: string | null;
  readonly customer: number;
  readonly customParameters: Record<string, ArticleCustomValue>;
  readonly parameters: Record<string, string>;
  readonly schemaVersion: number;
}

export interface ArticleScanResult {
  readonly created: number;
  readonly issues: ArticleIssue[];
  readonly removed: number;
  /** `null` when `articlesDirectory` is not configured. */
  readonly root: string | null;
  readonly scanned: number;
  readonly unchanged: number;
  readonly updated: number;
}
