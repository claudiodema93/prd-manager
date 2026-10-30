/**
 * Shared customer-domain types and contracts.
 *
 * This module deliberately has no Electron or filesystem imports so the
 * customer service can be unit-tested in isolation and reused by the main
 * process without pulling in the renderer.
 */

export const PARAMETER_TYPES = ["text", "number", "bool"] as const;

export type ParameterType = (typeof PARAMETER_TYPES)[number];

/**
 * A single article/revision parameter declared in `customer_data.json`.
 * `default` is stored as a string on disk (for example `"0"`), even for
 * numeric parameters.
 */
export interface ParameterDefinition {
  readonly default?: string;
  readonly required: boolean;
  readonly type: ParameterType;
}

export type ParameterDefinitions = Readonly<
  Record<string, ParameterDefinition>
>;

/**
 * The `article` or `revision` section of `customer_data.json`.
 */
export interface CustomerSectionDefinition {
  readonly key: string;
  readonly parameters: ParameterDefinitions;
  readonly schemaVersion: number;
}

/**
 * The normalised v1 form of `customer_data.json`. `name` is the on-disk
 * `customerName`; the legacy duplicated `revisionSchemaVersion` field lives
 * only in the reader and is not part of this model.
 */
export interface CustomerConfig {
  readonly article: CustomerSectionDefinition;
  readonly name: string;
  readonly revision: CustomerSectionDefinition;
  readonly schemaVersion: number;
}

export type CustomerIssueSeverity = "warning" | "error";

/** Issue messages are cached and validated at the IPC boundary. */
export const MAX_CUSTOMER_ISSUE_MESSAGE_LENGTH = 1024;

export const CUSTOMER_ISSUE_CODES = [
  "ARTICLE_INVALID",
  "ARTICLE_SYMLINK",
  "CONFIG_INVALID",
  "CONFIG_INVALID_JSON",
  "CONFIG_MISSING",
  "CONFIG_UNREADABLE",
  "ENTRY_UNEXPECTED",
  "FOLDER_NOT_DIRECTORY",
  "FOLDER_SYMLINK",
  "FOLDER_UNREADABLE",
  "ROOT_MISSING",
  "ROOT_NOT_DIRECTORY",
  "ROOT_SYMLINK",
  "ROOT_UNREADABLE",
] as const;

export type CustomerIssueCode = (typeof CUSTOMER_ISSUE_CODES)[number];

/**
 * A non-fatal problem found while scanning one customer folder. Issues are
 * cached in `metadata_json` so the renderer can explain a warning/error
 * without touching the filesystem again.
 */
export interface CustomerIssue {
  readonly code: CustomerIssueCode;
  readonly message: string;
  readonly path?: string;
  readonly severity: CustomerIssueSeverity;
}

/**
 * The shape stored in the `customers.metadata_json` column. The column is
 * reused intentionally: the database is a disposable cache, so the customer
 * definition does not need its own tables or a schema migration.
 */
export interface CustomerCacheMetadata {
  readonly article: CustomerSectionDefinition | null;
  readonly articleCount: number;
  readonly issues: CustomerIssue[];
  readonly revision: CustomerSectionDefinition | null;
}

export interface CustomerScanResult {
  readonly created: number;
  readonly issues: CustomerIssue[];
  readonly removed: number;
  /** `null` when `articlesDirectory` is not configured. */
  readonly root: string | null;
  readonly scanned: number;
  readonly unchanged: number;
  readonly updated: number;
}
