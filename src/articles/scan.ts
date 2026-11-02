/**
 * Startup/manual scanner for the article cache.
 *
 * The filesystem is the source of truth: every run rereads the articles root,
 * parses each `customer-XXXX/customer_data.json`, inspects every direct child
 * folder of a valid customer and reconciles the `articles` table. Only valid
 * articles (a readable, valid `article_data.json`) produce a row. Every cached
 * row that was not seen during the walk is deleted, because the cache is
 * single-root: stale rows from a previous root or from a customer whose config
 * became invalid must not survive.
 *
 * The whole scan runs under the customer lock so a startup scan and a manual
 * refresh cannot interleave. `scanArticlesLocked` is the lock-free body; it must
 * never call itself or another scanner.
 */

import type { Dirent, Stats } from "node:fs";
import { opendir } from "node:fs/promises";
import path from "node:path";
import {
  MAX_CUSTOMER_CONFIG_BYTES,
  parseCustomerConfig,
} from "../customers/config";
import { CustomerServiceError } from "../customers/errors";
import {
  lstatIfExists,
  parseCustomerFolderName,
  readJsonFile,
} from "../customers/folder";
import { withCustomerLock } from "../customers/lock";
import type { CustomerConfig } from "../customers/types";
import { parseArticleConfig } from "./config";
import { ArticleServiceError } from "./errors";
import {
  ARTICLE_DATA_FILE_NAME,
  articleFolderFingerprint,
  readArticleDataFile,
} from "./folder";
import { countValidRevisions, RevisionMatchBudgetError } from "./revisions";
import {
  type ArticleDatabase,
  type ArticleRecord,
  deleteArticleRow,
  getArticleRow,
  listArticleRows,
  upsertArticleRow,
} from "./store";
import {
  type ArticleCacheMetadata,
  type ArticleIssue,
  type ArticleIssueCode,
  type ArticleIssueSeverity,
  type ArticleScanResult,
  MAX_ARTICLE_ISSUE_MESSAGE_LENGTH,
} from "./types";

const CONFIG_FILE_NAME = "customer_data.json";
const CUSTOMER_FOLDER_PREFIX = "customer-";

/** The last slot of the scan-level list is reserved for the truncation note. */
const MAX_SCAN_ISSUES = 200;

/**
 * A hostile or misconfigured root must not keep the customer lock busy for an
 * unbounded amount of time. Exceeding the budget aborts before any cache write,
 * leaving the previous snapshot intact.
 */
const MAX_ROOT_ENTRIES = 50_000;

/**
 * Per-customer budget, streamed rather than materialised: a hostile or broken
 * customer folder must not make the scanner hold an unbounded listing.
 */
const MAX_CUSTOMER_ENTRIES = 10_000;

/** Issue paths must satisfy the wire schema (`path` max 4096). */
const MAX_ISSUE_PATH_LENGTH = 4096;

/**
 * There is no dedicated truncation issue code. The scanner-level
 * `ENTRY_UNEXPECTED` warning is the closest catch-all and is also what the
 * customer scanner uses for truncation.
 */
const TRUNCATION_ISSUE_CODE: ArticleIssueCode = "ENTRY_UNEXPECTED";

export interface ScanArticlesOptions {
  readonly db: ArticleDatabase;
  /**
   * Test seam: override the per-customer safety budget. Production callers use
   * the module default.
   */
  readonly maxCustomerEntries?: number;
  /**
   * Test seam: override the safety budget. Production callers use the module
   * default.
   */
  readonly maxRootEntries?: number;
  readonly rootDirectory: string | null;
}

interface Counters {
  created: number;
  scanned: number;
  unchanged: number;
  updated: number;
}

interface RowSnapshot {
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

type EntryKind = "directory" | "other" | "symlink";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function articleIssue(
  code: ArticleIssueCode,
  severity: ArticleIssueSeverity,
  message: string,
  issuePath?: string
): ArticleIssue {
  const boundedMessage =
    message.length <= MAX_ARTICLE_ISSUE_MESSAGE_LENGTH
      ? message
      : `${message.slice(0, MAX_ARTICLE_ISSUE_MESSAGE_LENGTH - 1)}…`;
  // An over-long path is omitted instead of truncated: the wire schema's upper
  // bound must never make one bad entry reject the whole scan response.
  const boundedPath =
    issuePath !== undefined && issuePath.length <= MAX_ISSUE_PATH_LENGTH
      ? issuePath
      : undefined;

  return boundedPath === undefined
    ? { code, message: boundedMessage, severity }
    : { code, message: boundedMessage, path: boundedPath, severity };
}

/**
 * Preserves the cached rows of one customer when its folder cannot be read at
 * all. The failure may be transient (permissions, unmounted volume), so the
 * final reconciliation must not treat the invisible rows as deleted.
 */
function markCustomerRowsSeen(
  db: ArticleDatabase,
  customerFolderPath: string,
  seen: Set<string>
): void {
  for (const row of listArticleRows(db)) {
    if (row.customerFolderPath === customerFolderPath) {
      seen.add(row.folderPath);
    }
  }
}

function emptyScanResult(root: string | null): ArticleScanResult {
  return {
    created: 0,
    issues: [],
    removed: 0,
    root,
    scanned: 0,
    unchanged: 0,
    updated: 0,
  };
}

/**
 * A root-level failure leaves the cache untouched: without a listable root the
 * scanner cannot tell a deleted article from an unmounted folder.
 */
function failedScan(
  root: string,
  code: ArticleIssueCode,
  message: string
): ArticleScanResult {
  return {
    created: 0,
    issues: [articleIssue(code, "error", message, root)],
    removed: 0,
    root,
    scanned: 0,
    unchanged: 0,
    updated: 0,
  };
}

function compareEntryNames(left: Dirent, right: Dirent): number {
  if (left.name === right.name) {
    return 0;
  }

  return left.name < right.name ? -1 : 1;
}

/**
 * Some network/FUSE filesystems report `DT_UNKNOWN`, so a `Dirent` can answer
 * neither `isDirectory()` nor `isFile()`. Falling back to `lstat` (never `stat`)
 * keeps symlinks excluded and the scan correct on those roots.
 */
async function resolveEntryKind(
  entry: Dirent,
  entryPath: string
): Promise<EntryKind> {
  if (entry.isSymbolicLink()) {
    return "symlink";
  }

  if (entry.isDirectory()) {
    return "directory";
  }

  if (entry.isFile()) {
    return "other";
  }

  try {
    const stats = await lstatIfExists(entryPath);

    if (!stats) {
      return "other";
    }

    if (stats.isSymbolicLink()) {
      return "symlink";
    }

    return stats.isDirectory() ? "directory" : "other";
  } catch {
    return "other";
  }
}

/**
 * Classifies a `customer_data.json` read/parse failure. Missing files are
 * reported separately by the caller; this helper keeps malformed JSON distinct
 * from an unreadable file and from an invalid config shape.
 */
function configFailure(
  error: unknown,
  folderName: string,
  configPath: string
): ArticleIssue {
  const message = `Customer folder "${folderName}" has an invalid ${CONFIG_FILE_NAME}: ${errorMessage(error)}`;

  if (error instanceof CustomerServiceError) {
    if (error.code === "CONFIG_INVALID_JSON") {
      return articleIssue(
        "CUSTOMER_CONFIG_INVALID_JSON",
        "error",
        message,
        configPath
      );
    }

    if (
      error.code === "CONFIG_INVALID" ||
      error.code === "CONFIG_UNSUPPORTED_VERSION" ||
      error.code === "CONFIG_VERSION_CONFLICT" ||
      error.code === "KEY_TEMPLATE_INVALID"
    ) {
      return articleIssue(
        "CUSTOMER_CONFIG_INVALID",
        "error",
        message,
        configPath
      );
    }
  }

  return articleIssue(
    "CUSTOMER_CONFIG_UNREADABLE",
    "error",
    message,
    configPath
  );
}

/**
 * Classifies an `article_data.json` read/parse failure. The read helper already
 * distinguishes missing, malformed JSON and unreadable files; parsing adds
 * `ARTICLE_DATA_INVALID`.
 */
function articleDataFailure(
  error: unknown,
  folderName: string,
  dataPath: string
): ArticleIssue {
  const message = `Article folder "${folderName}" has an invalid ${ARTICLE_DATA_FILE_NAME}: ${errorMessage(error)}`;

  if (error instanceof ArticleServiceError) {
    if (error.code === "ARTICLE_DATA_MISSING") {
      return articleIssue("ARTICLE_DATA_MISSING", "warning", message, dataPath);
    }

    if (error.code === "ARTICLE_DATA_INVALID_JSON") {
      return articleIssue(
        "ARTICLE_DATA_INVALID_JSON",
        "warning",
        message,
        dataPath
      );
    }

    if (error.code === "ARTICLE_DATA_INVALID") {
      return articleIssue("ARTICLE_DATA_INVALID", "warning", message, dataPath);
    }
  }

  return articleIssue("ARTICLE_DATA_UNREADABLE", "warning", message, dataPath);
}

function isRowUnchanged(row: ArticleRecord, next: RowSnapshot): boolean {
  return (
    row.activeRevision === next.activeRevision &&
    row.customerCode === next.customerCode &&
    row.customerFolderPath === next.customerFolderPath &&
    row.folderMtimeMs === next.folderMtimeMs &&
    row.folderName === next.folderName &&
    row.folderPath === next.folderPath &&
    row.revisionCount === next.revisionCount &&
    row.schemaVersion === next.schemaVersion &&
    JSON.stringify(row.metadataJson) === JSON.stringify(next.metadata)
  );
}

async function inspectRoot(root: string): Promise<ArticleScanResult | null> {
  let stats: Stats | undefined;

  try {
    stats = await lstatIfExists(root);
  } catch (error) {
    return failedScan(
      root,
      "ROOT_UNREADABLE",
      `Unable to inspect article root "${root}": ${errorMessage(error)}`
    );
  }

  if (!stats) {
    return failedScan(
      root,
      "ROOT_MISSING",
      `Article root "${root}" does not exist.`
    );
  }

  if (stats.isSymbolicLink()) {
    return failedScan(
      root,
      "ROOT_SYMLINK",
      `Refusing to scan article root "${root}": it is a symbolic link.`
    );
  }

  if (!stats.isDirectory()) {
    return failedScan(
      root,
      "ROOT_NOT_DIRECTORY",
      `Article root "${root}" is not a directory.`
    );
  }

  return null;
}

/**
 * Streams the root so a hostile directory is abandoned as soon as it exceeds
 * the budget: `readdir` would materialise the whole listing first, which is the
 * memory cost the budget is meant to avoid.
 */
async function readRootEntries(
  root: string,
  maxEntries: number
): Promise<ArticleScanResult | Dirent[]> {
  const entries: Dirent[] = [];

  try {
    const directory = await opendir(root);

    try {
      for await (const entry of directory) {
        if (entries.length >= maxEntries) {
          return failedScan(
            root,
            "ROOT_UNREADABLE",
            `Article root "${root}" has more than ${maxEntries} entries; the maximum is ${maxEntries}.`
          );
        }

        entries.push(entry);
      }
    } finally {
      await directory.close().catch(() => undefined);
    }
  } catch (error) {
    return failedScan(
      root,
      "ROOT_UNREADABLE",
      `Unable to read article root "${root}": ${errorMessage(error)}`
    );
  }

  return entries.sort(compareEntryNames);
}

interface ArticleInspectionInput {
  readonly articleFolderPath: string;
  readonly config: CustomerConfig;
  readonly customerCode: string;
  readonly customerFolderPath: string;
  readonly folderName: string;
  readonly recordIssue: (issue: ArticleIssue) => void;
}

/**
 * Sentinel returned when the article data is valid but its revision count
 * could not be determined because the matcher's work budget ran out. The
 * existing cached row (if any) must be preserved instead of being deleted.
 */
const PRESERVE_ROW = "preserve-row" as const;

/**
 * Reads, parses and fingerprints one article folder. Returns `null` after
 * recording the matching issue when the folder cannot be cached, or
 * `PRESERVE_ROW` when the cached row must survive an inconclusive count.
 */
async function buildArticleSnapshot(
  input: ArticleInspectionInput
): Promise<RowSnapshot | null | typeof PRESERVE_ROW> {
  const {
    articleFolderPath,
    config,
    customerCode,
    customerFolderPath,
    folderName,
    recordIssue,
  } = input;
  const dataPath = path.join(articleFolderPath, ARTICLE_DATA_FILE_NAME);
  let raw: unknown;

  try {
    raw = await readArticleDataFile(dataPath);
  } catch (error) {
    recordIssue(articleDataFailure(error, folderName, dataPath));
    return null;
  }

  let articleConfig: ArticleCacheMetadata;

  try {
    articleConfig = parseArticleConfig(raw, config.article, customerCode);
  } catch (error) {
    recordIssue(articleDataFailure(error, folderName, dataPath));
    return null;
  }

  let revisionCount: number;

  try {
    revisionCount = await countValidRevisions(
      articleFolderPath,
      config.revision
    );
  } catch (error) {
    // An unknown revision count must never be cached as 0.
    recordIssue(
      articleIssue(
        "ARTICLE_DATA_UNREADABLE",
        "warning",
        `Unable to count revisions in "${articleFolderPath}": ${errorMessage(error)}`,
        articleFolderPath
      )
    );

    // Budget exhaustion is inconclusive, not invalid: the data file parsed, so
    // keep the previous row rather than deleting a legitimate article.
    return error instanceof RevisionMatchBudgetError ? PRESERVE_ROW : null;
  }

  return {
    activeRevision: articleConfig.activeRevision,
    customerCode,
    customerFolderPath,
    folderMtimeMs: await articleFolderFingerprint(articleFolderPath),
    folderName,
    folderPath: articleFolderPath,
    metadata: articleConfig,
    revisionCount,
    schemaVersion: articleConfig.schemaVersion,
  };
}

interface CustomerReconcileInput {
  readonly config: CustomerConfig;
  readonly counters: Counters;
  readonly customerCode: string;
  readonly customerFolderName: string;
  readonly customerFolderPath: string;
  readonly db: ArticleDatabase;
  readonly maxEntries: number;
  readonly recordIssue: (issue: ArticleIssue) => void;
  readonly seen: Set<string>;
}

/** A transient listing failure keeps the customer's cached rows alive. */
function recordCustomerListFailure(
  input: CustomerReconcileInput,
  message: string
): void {
  markCustomerRowsSeen(input.db, input.customerFolderPath, input.seen);
  input.recordIssue(
    articleIssue(
      "ARTICLE_DATA_UNREADABLE",
      "error",
      message,
      input.customerFolderPath
    )
  );
}

async function reconcileCustomerEntry(
  input: CustomerReconcileInput,
  entry: Dirent
): Promise<void> {
  const {
    config,
    counters,
    customerCode,
    customerFolderPath,
    db,
    recordIssue,
    seen,
  } = input;

  if (entry.name.startsWith(".") || entry.name === CONFIG_FILE_NAME) {
    return;
  }

  const articleFolderPath = path.join(customerFolderPath, entry.name);
  const kind = await resolveEntryKind(entry, articleFolderPath);

  if (kind === "symlink") {
    recordIssue(
      articleIssue(
        "ARTICLE_FOLDER_SYMLINK",
        "warning",
        `Article folder "${entry.name}" is a symbolic link and was ignored.`,
        articleFolderPath
      )
    );
    return;
  }

  if (kind !== "directory") {
    recordIssue(
      articleIssue(
        "ARTICLE_FOLDER_NOT_DIRECTORY",
        "warning",
        `Article entry "${entry.name}" is not a directory.`,
        articleFolderPath
      )
    );
    return;
  }

  const snapshot = await buildArticleSnapshot({
    articleFolderPath,
    config,
    customerCode,
    customerFolderPath,
    folderName: entry.name,
    recordIssue,
  });

  if (snapshot === PRESERVE_ROW) {
    // An inconclusive revision count must not wipe the cached row.
    seen.add(articleFolderPath);
    return;
  }

  if (snapshot === null) {
    return;
  }

  // Remember only successfully cached articles: an invalid folder must let a
  // leftover row from an earlier scan disappear.
  seen.add(articleFolderPath);

  const existing = getArticleRow(db, articleFolderPath);

  if (existing !== null && isRowUnchanged(existing, snapshot)) {
    counters.unchanged += 1;
    counters.scanned += 1;
    return;
  }

  upsertArticleRow(db, snapshot);

  if (existing === null) {
    counters.created += 1;
  } else {
    counters.updated += 1;
  }

  counters.scanned += 1;
}

/**
 * Inspects every direct child of a valid customer folder. A child that cannot
 * be cached is reported and skipped, so it contributes no `seen` path and its
 * stale row is removed at the end of the scan. The customer folder itself is
 * streamed, and a listing failure or an exceeded budget marks the customer's
 * cached rows as seen so a transient failure cannot wipe its cache slice.
 */
async function reconcileCustomerArticles(
  input: CustomerReconcileInput
): Promise<void> {
  const { customerFolderName, customerFolderPath, maxEntries } = input;

  let directory: Awaited<ReturnType<typeof opendir>>;

  try {
    directory = await opendir(customerFolderPath);
  } catch (error) {
    recordCustomerListFailure(
      input,
      `Unable to read articles in "${customerFolderName}": ${errorMessage(error)}`
    );
    return;
  }

  try {
    let entryCount = 0;

    for (;;) {
      let entry: Dirent | null;

      try {
        // biome-ignore lint/performance/noAwaitInLoops: entries are inspected sequentially.
        entry = await directory.read();
      } catch (error) {
        recordCustomerListFailure(
          input,
          `Unable to read articles in "${customerFolderName}": ${errorMessage(error)}`
        );
        return;
      }

      if (entry === null) {
        break;
      }

      entryCount += 1;

      if (entryCount > maxEntries) {
        recordCustomerListFailure(
          input,
          `Customer folder "${customerFolderName}" has more than ${maxEntries} entries; the maximum is ${maxEntries}. The cached articles were left unchanged.`
        );
        return;
      }

      await reconcileCustomerEntry(input, entry);
    }
  } finally {
    await directory.close().catch(() => undefined);
  }
}

async function scanCustomerFolder(input: {
  readonly counters: Counters;
  readonly customerCode: string;
  readonly customerFolderName: string;
  readonly customerFolderPath: string;
  readonly db: ArticleDatabase;
  readonly maxEntries: number;
  readonly recordIssue: (issue: ArticleIssue) => void;
  readonly seen: Set<string>;
}): Promise<void> {
  const { customerFolderName, customerFolderPath, recordIssue } = input;
  const configPath = path.join(customerFolderPath, CONFIG_FILE_NAME);
  let raw: unknown;

  try {
    raw = await readJsonFile(configPath, MAX_CUSTOMER_CONFIG_BYTES);
  } catch (error) {
    recordIssue(configFailure(error, customerFolderName, configPath));
    return;
  }

  if (raw === undefined) {
    recordIssue(
      articleIssue(
        "CUSTOMER_CONFIG_MISSING",
        "error",
        `Customer folder "${customerFolderName}" is missing ${CONFIG_FILE_NAME}.`,
        configPath
      )
    );
    return;
  }

  let config: CustomerConfig;

  try {
    config = parseCustomerConfig(raw);
  } catch (error) {
    recordIssue(configFailure(error, customerFolderName, configPath));
    return;
  }

  await reconcileCustomerArticles({ ...input, config });
}

async function reconcileRoot(
  db: ArticleDatabase,
  root: string,
  entries: readonly Dirent[],
  maxCustomerEntries: number
): Promise<{
  counters: Counters;
  issues: readonly ArticleIssue[];
  seen: ReadonlySet<string>;
}> {
  const counters: Counters = {
    created: 0,
    scanned: 0,
    unchanged: 0,
    updated: 0,
  };
  const issues: ArticleIssue[] = [];
  const seen = new Set<string>();
  let issuesTruncated = false;

  // Cap while collecting instead of truncating at the end: a hostile root can
  // produce thousands of issues per customer, and holding all of them before
  // the final slice is the memory cost the cap is meant to avoid.
  const recordIssue = (issue: ArticleIssue): void => {
    if (issues.length < MAX_SCAN_ISSUES - 1) {
      issues.push(issue);
      return;
    }

    issuesTruncated = true;
  };

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const parsed = parseCustomerFolderName(entry.name);

    if (parsed === null) {
      if (entry.name.startsWith(CUSTOMER_FOLDER_PREFIX)) {
        recordIssue(
          articleIssue(
            "ENTRY_UNEXPECTED",
            "warning",
            `Ignoring "${entry.name}": expected a customer folder named customer-0001 to customer-9999.`,
            path.join(root, entry.name)
          )
        );
      }

      continue;
    }

    const customerFolderPath = path.join(root, entry.name);
    let stats: Stats | undefined;

    try {
      // biome-ignore lint/performance/noAwaitInLoops: customer folders are inspected sequentially to keep issue order deterministic.
      stats = await lstatIfExists(customerFolderPath);
    } catch (error) {
      // A transient inspection failure must not delete the customer's rows.
      markCustomerRowsSeen(db, customerFolderPath, seen);
      recordIssue(
        articleIssue(
          "CUSTOMER_CONFIG_UNREADABLE",
          "error",
          `Unable to inspect customer folder "${entry.name}": ${errorMessage(error)}`,
          customerFolderPath
        )
      );
      continue;
    }

    if (!stats) {
      // The folder disappeared between the directory listing and the
      // inspection: it must not keep a stale row alive.
      continue;
    }

    if (stats.isSymbolicLink()) {
      recordIssue(
        articleIssue(
          "CUSTOMER_FOLDER_SYMLINK",
          "error",
          `Customer folder "${entry.name}" is a symbolic link and was not followed.`,
          customerFolderPath
        )
      );
      continue;
    }

    if (!stats.isDirectory()) {
      // A folder replaced by a plain file cannot be enumerated, but the rows it
      // used to hold may belong to a transient filesystem state.
      markCustomerRowsSeen(db, customerFolderPath, seen);
      recordIssue(
        articleIssue(
          "CUSTOMER_FOLDER_NOT_DIRECTORY",
          "error",
          `Customer folder "${entry.name}" is not a directory.`,
          customerFolderPath
        )
      );
      continue;
    }

    await scanCustomerFolder({
      counters,
      customerCode: parsed.customerCode,
      customerFolderName: parsed.folderName,
      customerFolderPath,
      db,
      maxEntries: maxCustomerEntries,
      recordIssue,
      seen,
    });
  }

  if (issuesTruncated) {
    issues.push(
      articleIssue(
        TRUNCATION_ISSUE_CODE,
        "warning",
        `Too many scan issues; only the first ${MAX_SCAN_ISSUES - 1} were recorded.`
      )
    );
  }

  return { counters, issues, seen };
}

/**
 * Lock-free scan body. `scanArticles` is the public entry point; callers that
 * already hold `withCustomerLock` use this one instead.
 */
export async function scanArticlesLocked(
  options: ScanArticlesOptions
): Promise<ArticleScanResult> {
  const { db, rootDirectory } = options;

  if (rootDirectory === null) {
    return emptyScanResult(null);
  }

  // Check before resolving: an invalid root must be reported without being
  // normalised or touched.
  if (rootDirectory.includes("\0")) {
    return failedScan(
      rootDirectory,
      "ROOT_UNREADABLE",
      "Article root path is invalid: it contains a NUL character."
    );
  }

  const root = path.resolve(rootDirectory);

  const rootFailure = await inspectRoot(root);

  if (rootFailure) {
    return rootFailure;
  }

  const maxRootEntries = options.maxRootEntries ?? MAX_ROOT_ENTRIES;
  const entries = await readRootEntries(root, maxRootEntries);

  if (!Array.isArray(entries)) {
    return entries;
  }

  const summary = await reconcileRoot(
    db,
    root,
    entries,
    options.maxCustomerEntries ?? MAX_CUSTOMER_ENTRIES
  );
  let removed = 0;

  // The cache is single-root: any row not seen while enumerating the current
  // root is stale, including rows under a customer whose config became invalid.
  for (const row of listArticleRows(db)) {
    if (summary.seen.has(row.folderPath)) {
      continue;
    }

    removed += deleteArticleRow(db, row.folderPath);
  }

  return {
    created: summary.counters.created,
    // `reconcileRoot` already caps and truncates while collecting.
    issues: [...summary.issues],
    removed,
    root,
    scanned: summary.counters.scanned,
    unchanged: summary.counters.unchanged,
    updated: summary.counters.updated,
  };
}

/**
 * Reconciles the `articles` cache with the filesystem. Passing `null` (no
 * `articlesDirectory` configured) leaves the database untouched.
 */
export function scanArticles(
  options: ScanArticlesOptions
): Promise<ArticleScanResult> {
  return withCustomerLock(() => scanArticlesLocked(options));
}
