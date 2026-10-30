/**
 * Startup/manual scanner for the customer cache.
 *
 * The filesystem is the source of truth: every run rereads the root folder,
 * parses each `customer-XXXX/customer_data.json`, counts the valid articles and
 * reconciles the `customers` table. Rows under the root that no longer exist
 * are deleted; rows outside the root are never touched.
 *
 * The whole scan runs under the customer lock so a startup scan and a manual
 * refresh cannot interleave. Callers must not nest this call inside another
 * `withCustomerLock` block.
 */

import type { Dirent, Stats } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { MAX_CUSTOMER_CONFIG_BYTES, parseCustomerConfig } from "./config";
import { CustomerServiceError } from "./errors";
import {
  type ArticleCountResult,
  type CustomerFolderName,
  countValidArticles,
  lstatIfExists,
  parseCustomerFolderName,
  readJsonFile,
} from "./folder";
import { withCustomerLock } from "./lock";
import {
  type CustomerDatabase,
  type CustomerRecord,
  type CustomerRowStatus,
  deleteCustomerRow,
  getCustomerRow,
  listCustomerRows,
  upsertCustomerRow,
} from "./store";
import type {
  CustomerCacheMetadata,
  CustomerConfig,
  CustomerIssue,
  CustomerIssueCode,
  CustomerIssueSeverity,
  CustomerScanResult,
} from "./types";
import { MAX_CUSTOMER_ISSUE_MESSAGE_LENGTH } from "./types";

const CONFIG_FILE_NAME = "customer_data.json";
const CUSTOMER_FOLDER_PREFIX = "customer-";

/** The last slot of each capped list is reserved for the truncation note. */
const MAX_SCAN_ISSUES = 200;
const MAX_CUSTOMER_ISSUES = 100;

/**
 * A hostile or misconfigured root must not keep the customer lock busy for an
 * unbounded amount of time. The budget is well above the 9,999 possible
 * customer codes, so a legitimate root with extra files still scans. Exceeding
 * it aborts before any cache write, leaving the previous snapshot intact.
 */
const MAX_ROOT_ENTRIES = 50_000;

/**
 * There is no dedicated truncation issue code. The scanner-level
 * `ENTRY_UNEXPECTED` warning is the closest catch-all, so the truncation note
 * reuses it instead of inventing a code the renderer does not know.
 */
const TRUNCATION_ISSUE_CODE: CustomerIssueCode = "ENTRY_UNEXPECTED";

export interface ScanCustomersOptions {
  readonly db: CustomerDatabase;
  /**
   * Test seam: override the safety budget. Production callers use the
   * module default.
   */
  readonly maxRootEntries?: number;
  readonly rootDirectory: string | null;
}

interface ScannedCustomer {
  readonly articleCount: number;
  readonly config: CustomerConfig | null;
  readonly issues: readonly CustomerIssue[];
  readonly status: CustomerRowStatus;
}

interface RowSnapshot {
  readonly articleSchemaVersion: number | null;
  readonly customerCode: string;
  readonly folderMtimeMs: number;
  readonly folderName: string;
  readonly metadata: CustomerCacheMetadata;
  readonly name: string | null;
  readonly revisionSchemaVersion: number | null;
  readonly schemaVersion: number | null;
  readonly status: CustomerRowStatus;
}

type Reconciliation = "created" | "unchanged" | "updated";

interface ReconciledCustomer {
  readonly issues: readonly CustomerIssue[];
  readonly outcome: Reconciliation;
}

function customerIssue(
  code: CustomerIssueCode,
  severity: CustomerIssueSeverity,
  message: string,
  issuePath?: string
): CustomerIssue {
  const boundedMessage =
    message.length <= MAX_CUSTOMER_ISSUE_MESSAGE_LENGTH
      ? message
      : `${message.slice(0, MAX_CUSTOMER_ISSUE_MESSAGE_LENGTH - 1)}…`;

  return issuePath === undefined
    ? { code, message: boundedMessage, severity }
    : { code, message: boundedMessage, path: issuePath, severity };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Keeps at most `max` issues and, when the input is longer, replaces the final
 * slot with a warning that explains the truncation.
 */
function capIssues(
  issues: readonly CustomerIssue[],
  max: number,
  scope: string,
  issuePath?: string
): CustomerIssue[] {
  if (issues.length <= max) {
    return [...issues];
  }

  return [
    ...issues.slice(0, max - 1),
    customerIssue(
      TRUNCATION_ISSUE_CODE,
      "warning",
      `Too many ${scope} issues; only the first ${max - 1} were recorded.`,
      issuePath
    ),
  ];
}

function resolveStatus(issues: readonly CustomerIssue[]): CustomerRowStatus {
  if (issues.some((issue) => issue.severity === "error")) {
    return "error";
  }

  return issues.length > 0 ? "warning" : "ok";
}

function emptyScanResult(root: string | null): CustomerScanResult {
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
 * scanner cannot tell a deleted customer from an unmounted folder.
 */
function failedScan(
  root: string,
  code: CustomerIssueCode,
  message: string
): CustomerScanResult {
  return {
    created: 0,
    issues: [customerIssue(code, "error", message, root)],
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
 * `lstatIfExists` only swallows ENOENT; probing `customer_data.json` inside a
 * customer entry that turned out to be a regular file raises ENOTDIR. The
 * fingerprint is informational, so every inspection failure means "no config
 * timestamp".
 */
async function lstatQuiet(filePath: string): Promise<Stats | undefined> {
  try {
    return await lstatIfExists(filePath);
  } catch {
    return undefined;
  }
}

function configFailure(
  error: unknown,
  folderName: string,
  configPath: string
): CustomerIssue {
  const message = `Customer folder "${folderName}" has an invalid ${CONFIG_FILE_NAME}: ${errorMessage(error)}`;

  if (error instanceof CustomerServiceError) {
    if (error.code === "CONFIG_INVALID_JSON") {
      return customerIssue("CONFIG_INVALID_JSON", "error", message, configPath);
    }

    if (
      error.code === "CONFIG_INVALID" ||
      error.code === "CONFIG_UNSUPPORTED_VERSION" ||
      error.code === "CONFIG_VERSION_CONFLICT"
    ) {
      return customerIssue("CONFIG_INVALID", "error", message, configPath);
    }
  }

  return customerIssue("CONFIG_UNREADABLE", "error", message, configPath);
}

/**
 * Reads one matched customer entry. Symlinked and non-directory entries are
 * reported but never followed, and the article count is only computed for a
 * real directory. A missing or invalid config does not stop the count: the
 * renderer still shows how many articles the folder contains.
 */
async function inspectCustomerFolder(input: {
  readonly customerCode: string;
  readonly folderName: string;
  readonly folderPath: string;
  readonly stats: Stats;
}): Promise<ScannedCustomer> {
  if (input.stats.isSymbolicLink()) {
    const issues = [
      customerIssue(
        "FOLDER_SYMLINK",
        "error",
        `Customer folder "${input.folderName}" is a symbolic link and was not followed.`,
        input.folderPath
      ),
    ];

    return { articleCount: 0, config: null, issues, status: "error" };
  }

  if (!input.stats.isDirectory()) {
    const issues = [
      customerIssue(
        "FOLDER_NOT_DIRECTORY",
        "error",
        `Customer folder "${input.folderName}" is not a directory.`,
        input.folderPath
      ),
    ];

    return { articleCount: 0, config: null, issues, status: "error" };
  }

  const configPath = path.join(input.folderPath, CONFIG_FILE_NAME);
  const issues: CustomerIssue[] = [];
  let config: CustomerConfig | null = null;

  try {
    const value = await readJsonFile(configPath, MAX_CUSTOMER_CONFIG_BYTES);

    if (value === undefined) {
      issues.push(
        customerIssue(
          "CONFIG_MISSING",
          "error",
          `Customer folder "${input.folderName}" is missing ${CONFIG_FILE_NAME}.`,
          configPath
        )
      );
    } else {
      try {
        config = parseCustomerConfig(value);
      } catch (error) {
        issues.push(configFailure(error, input.folderName, configPath));
      }
    }
  } catch (error) {
    issues.push(configFailure(error, input.folderName, configPath));
  }

  let counted: ArticleCountResult;

  try {
    counted = await countValidArticles(input.folderPath, input.customerCode);
  } catch (error) {
    // A single unreadable customer folder must not abort the whole scan, but
    // the row must be an error: an unknown article count must never enable a
    // delete or a key change in the UI.
    issues.push(
      customerIssue(
        "FOLDER_UNREADABLE",
        "error",
        `Unable to inspect articles in "${input.folderName}": ${errorMessage(error)}`,
        input.folderPath
      )
    );
    counted = { articleCount: 0, issues: [] };
  }

  issues.push(...counted.issues);

  return {
    articleCount: counted.articleCount,
    config,
    issues: capIssues(
      issues,
      MAX_CUSTOMER_ISSUES,
      `customer "${input.folderName}"`,
      input.folderPath
    ),
    status: resolveStatus(issues),
  };
}

function isRowUnchanged(row: CustomerRecord, next: RowSnapshot): boolean {
  return (
    row.customerCode === next.customerCode &&
    row.folderName === next.folderName &&
    row.name === next.name &&
    row.folderMtimeMs === next.folderMtimeMs &&
    row.schemaVersion === next.schemaVersion &&
    row.articleSchemaVersion === next.articleSchemaVersion &&
    row.revisionSchemaVersion === next.revisionSchemaVersion &&
    row.status === next.status &&
    JSON.stringify(row.metadataJson) === JSON.stringify(next.metadata)
  );
}

/**
 * Inspects one matched folder and writes the cache row only when it differs.
 * Returning early on an unchanged row avoids churning `updatedAt` on every
 * startup.
 */
async function reconcileCustomerFolder(input: {
  readonly customer: CustomerFolderName;
  readonly db: CustomerDatabase;
  readonly folderPath: string;
  readonly stats: Stats;
}): Promise<ReconciledCustomer> {
  const { customer, db, folderPath, stats } = input;
  const customerScan = await inspectCustomerFolder({
    customerCode: customer.customerCode,
    folderName: customer.folderName,
    folderPath,
    stats,
  });

  const configStats = await lstatQuiet(path.join(folderPath, CONFIG_FILE_NAME));
  const folderMtimeMs = Math.floor(
    Math.max(stats.mtimeMs, configStats?.mtimeMs ?? 0)
  );

  const metadata: CustomerCacheMetadata = {
    article: customerScan.config?.article ?? null,
    articleCount: customerScan.articleCount,
    issues: [...customerScan.issues],
    revision: customerScan.config?.revision ?? null,
  };

  const snapshot: RowSnapshot = {
    articleSchemaVersion: customerScan.config?.article.schemaVersion ?? null,
    customerCode: customer.customerCode,
    folderMtimeMs,
    folderName: customer.folderName,
    metadata,
    name: customerScan.config?.name ?? null,
    revisionSchemaVersion: customerScan.config?.revision.schemaVersion ?? null,
    schemaVersion: customerScan.config?.schemaVersion ?? null,
    status: customerScan.status,
  };

  const existing = getCustomerRow(db, folderPath);

  if (existing !== null && isRowUnchanged(existing, snapshot)) {
    return { issues: customerScan.issues, outcome: "unchanged" };
  }

  upsertCustomerRow(db, {
    ...snapshot,
    folderPath,
    issues: customerScan.issues,
  });

  return {
    issues: customerScan.issues,
    outcome: existing === null ? "created" : "updated",
  };
}

async function inspectRoot(root: string): Promise<CustomerScanResult | null> {
  let stats: Stats | undefined;

  try {
    stats = await lstatIfExists(root);
  } catch (error) {
    return failedScan(
      root,
      "ROOT_UNREADABLE",
      `Unable to inspect customer root "${root}": ${errorMessage(error)}`
    );
  }

  if (!stats) {
    return failedScan(
      root,
      "ROOT_MISSING",
      `Customer root "${root}" does not exist.`
    );
  }

  if (stats.isSymbolicLink()) {
    return failedScan(
      root,
      "ROOT_SYMLINK",
      `Refusing to scan customer root "${root}": it is a symbolic link.`
    );
  }

  if (!stats.isDirectory()) {
    return failedScan(
      root,
      "ROOT_NOT_DIRECTORY",
      `Customer root "${root}" is not a directory.`
    );
  }

  return null;
}

async function readRootEntries(
  root: string
): Promise<CustomerScanResult | Dirent[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });

    return entries.sort(compareEntryNames);
  } catch (error) {
    return failedScan(
      root,
      "ROOT_UNREADABLE",
      `Unable to read customer root "${root}": ${errorMessage(error)}`
    );
  }
}

function appendCustomerIssues(
  scanIssues: CustomerIssue[],
  customerIssues: readonly CustomerIssue[],
  folderPath: string
): void {
  for (const issue of customerIssues) {
    scanIssues.push(
      issue.path === undefined ? { ...issue, path: folderPath } : issue
    );
  }
}

interface ReconcileSummary {
  readonly created: number;
  readonly issues: readonly CustomerIssue[];
  readonly scanned: number;
  readonly seen: ReadonlySet<string>;
  readonly unchanged: number;
  readonly updated: number;
}

/**
 * Walks the customer entries and reconciles each one. Entries are processed
 * sequentially so the scan-level issue order matches the sorted directory
 * listing.
 */
async function reconcileEntries(
  db: CustomerDatabase,
  root: string,
  entries: readonly Dirent[]
): Promise<ReconcileSummary> {
  const seen = new Set<string>();
  const issues: CustomerIssue[] = [];
  const counters = { created: 0, unchanged: 0, updated: 0 };
  let scanned = 0;

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const parsed = parseCustomerFolderName(entry.name);
    const folderPath = path.join(root, entry.name);

    if (parsed === null) {
      if (entry.name.startsWith(CUSTOMER_FOLDER_PREFIX)) {
        issues.push(
          customerIssue(
            "ENTRY_UNEXPECTED",
            "warning",
            `Ignoring "${entry.name}": expected a customer folder named customer-0001 to customer-9999.`,
            folderPath
          )
        );
      }

      continue;
    }

    // Remember every matched name before inspecting it, so a symlink or a
    // non-directory entry is never mistaken for a deleted customer.
    seen.add(folderPath);

    let stats: Stats | undefined;

    try {
      // biome-ignore lint/performance/noAwaitInLoops: customer folders are inspected sequentially to keep issue order deterministic.
      stats = await lstatIfExists(folderPath);
    } catch (error) {
      issues.push(
        customerIssue(
          "FOLDER_UNREADABLE",
          "error",
          `Unable to inspect customer folder "${entry.name}": ${errorMessage(error)}`,
          folderPath
        )
      );
      continue;
    }

    if (!stats) {
      continue;
    }

    // Database/programming errors are not folder-level problems: let them
    // abort the scan instead of mislabelling them as FOLDER_UNREADABLE.
    const reconciled = await reconcileCustomerFolder({
      customer: parsed,
      db,
      folderPath,
      stats,
    });

    counters[reconciled.outcome] += 1;
    scanned += 1;
    appendCustomerIssues(issues, reconciled.issues, folderPath);
  }

  return {
    created: counters.created,
    issues,
    scanned,
    seen,
    unchanged: counters.unchanged,
    updated: counters.updated,
  };
}

async function scanCustomersLocked(
  options: ScanCustomersOptions
): Promise<CustomerScanResult> {
  const { db, rootDirectory } = options;

  if (rootDirectory === null) {
    return emptyScanResult(null);
  }

  const root = path.resolve(rootDirectory);

  if (root.includes("\0")) {
    return failedScan(
      root,
      "ROOT_UNREADABLE",
      "Customer root path is invalid: it contains a NUL character."
    );
  }

  const rootFailure = await inspectRoot(root);

  if (rootFailure) {
    return rootFailure;
  }

  const entries = await readRootEntries(root);

  if (!Array.isArray(entries)) {
    return entries;
  }

  const maxRootEntries = options.maxRootEntries ?? MAX_ROOT_ENTRIES;

  if (entries.length > maxRootEntries) {
    return failedScan(
      root,
      "ROOT_UNREADABLE",
      `Customer root "${root}" has ${entries.length} entries; the maximum is ${maxRootEntries}.`
    );
  }

  const summary = await reconcileEntries(db, root, entries);
  let removed = 0;

  // The cache is single-root: any row not seen while enumerating the current
  // root is stale, including rows left behind by a previous articles directory.
  // This also recovers the snapshot when the preference change could not clear
  // the cache itself.
  for (const row of listCustomerRows(db)) {
    if (summary.seen.has(row.folderPath)) {
      continue;
    }

    removed += deleteCustomerRow(db, row.folderPath);
  }

  return {
    created: summary.created,
    issues: capIssues(summary.issues, MAX_SCAN_ISSUES, "scan"),
    removed,
    root,
    scanned: summary.scanned,
    unchanged: summary.unchanged,
    updated: summary.updated,
  };
}

/**
 * Reconciles the `customers` cache with the filesystem. Passing `null` (no
 * `articlesDirectory` configured) leaves the database untouched.
 */
export function scanCustomers(
  options: ScanCustomersOptions
): Promise<CustomerScanResult> {
  return withCustomerLock(() => scanCustomersLocked(options));
}
