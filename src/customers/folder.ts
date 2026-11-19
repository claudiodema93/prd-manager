import { randomUUID } from "node:crypto";
import { constants, type Dirent, type Stats } from "node:fs";
import { lstat, open, opendir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { moveFolderToTrash, TrashMoveError } from "../fs/trash";
import { type CustomerErrorCode, CustomerServiceError } from "./errors";
import { type CustomerIssue, MAX_CUSTOMER_ISSUE_MESSAGE_LENGTH } from "./types";

// biome-ignore lint/style/useNamedCaptureGroup: the positional capture is part of the published pattern contract.
export const CUSTOMER_FOLDER_PATTERN = /^customer-(\d{4})$/u;
export const CUSTOMER_CODE_PATTERN = /^\d{4}$/u;
export const MAX_ARTICLE_DATA_BYTES = 64 * 1024;

/** Issues kept per customer; the last slot is reserved for the truncation note. */
const MAX_ARTICLE_ISSUES = 100;

/**
 * Refuse to enumerate an unbounded article directory. Throwing (instead of
 * returning a partial count) keeps the delete guard and the key lock
 * conservative: callers cannot mistake an unknown count for "no articles".
 */
const MAX_ARTICLE_ENTRIES = 10_000;

const ARTICLE_FILE_NAME = "article_data.json";
const NUMERIC_STRING_PATTERN = /^[+-]?\d+$/u;

export interface CustomerFolderName {
  readonly customerCode: string;
  readonly folderName: string;
}

export interface ArticleCountResult {
  readonly articleCount: number;
  readonly issues: readonly CustomerIssue[];
}

/**
 * Resolves a path supplied by a caller. Every filesystem entry point in this
 * module requires an absolute path, so a relative value (which resolves
 * differently in development and packaged builds) or an embedded NUL is
 * rejected before it can reach the filesystem.
 */
function resolveAbsolutePath(
  filePath: string,
  code: CustomerErrorCode,
  label: string
): string {
  if (filePath.includes("\0")) {
    throw new CustomerServiceError(
      code,
      `${label} contains a NUL character: "${filePath}".`
    );
  }

  if (!path.isAbsolute(filePath)) {
    throw new CustomerServiceError(
      code,
      `${label} must be an absolute path (received "${filePath}").`
    );
  }

  return path.resolve(filePath);
}

function isErrno(error: unknown, ...codes: readonly string[]): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const { code } = error as { code?: unknown };

  return typeof code === "string" && codes.includes(code);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Wraps a caught error so its stack and context survive. `CustomerServiceError`
 * already accepts a `cause` option; this helper keeps the call sites readable.
 */
function serviceError(
  code: CustomerErrorCode,
  message: string,
  cause: unknown
): CustomerServiceError {
  return new CustomerServiceError(code, message, { cause });
}

export function parseCustomerFolderName(
  name: string
): CustomerFolderName | null {
  const match = CUSTOMER_FOLDER_PATTERN.exec(name);
  const customerCode = match?.[1];

  if (!customerCode || customerCode === "0000") {
    return null;
  }

  return { customerCode, folderName: name };
}

export function customerFolderNameForCode(code: string): string {
  if (!CUSTOMER_CODE_PATTERN.test(code) || code === "0000") {
    throw new CustomerServiceError(
      "CUSTOMER_CODE_INVALID",
      `Customer code must be four digits between 0001 and 9999 (received "${code}").`
    );
  }

  return `customer-${code}`;
}

/**
 * True when `child` is `parent` itself or lives strictly underneath it. Both
 * paths are resolved first, and the relative result is inspected instead of
 * string prefixes, so `/a/bc` is not treated as a child of `/a/b`. On Windows
 * a relative path on another drive is absolute, which also fails the check.
 */
export function isPathInside(parent: string, child: string): boolean {
  if (parent.includes("\0") || child.includes("\0")) {
    return false;
  }

  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  const relative = path.relative(resolvedParent, resolvedChild);

  if (relative === "") {
    return true;
  }

  return !(
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  );
}

export async function lstatIfExists(
  filePath: string
): Promise<Stats | undefined> {
  const resolved = resolveAbsolutePath(filePath, "READ_FAILED", "Path");

  try {
    // `throwIfNoEntry: false` is honoured by the sync API; recent Node
    // releases still reject the promises variant with ENOENT, so it is
    // swallowed here as well.
    const stats = await lstat(resolved, { throwIfNoEntry: false });

    return stats as Stats | undefined;
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}

export async function readJsonFile(
  filePath: string,
  maxBytes: number
): Promise<unknown | undefined> {
  const resolved = resolveAbsolutePath(filePath, "READ_FAILED", "File path");

  let stats: Stats | undefined;

  try {
    stats = await lstatIfExists(resolved);
  } catch (error) {
    throw serviceError(
      "READ_FAILED",
      `Unable to inspect "${resolved}".`,
      error
    );
  }

  if (!stats) {
    return undefined;
  }

  if (stats.isSymbolicLink()) {
    throw new CustomerServiceError(
      "READ_FAILED",
      `Refusing to read "${resolved}": it is a symbolic link.`
    );
  }

  if (!stats.isFile()) {
    throw new CustomerServiceError(
      "READ_FAILED",
      `Refusing to read "${resolved}": it is not a regular file.`
    );
  }

  if (stats.size > maxBytes) {
    throw new CustomerServiceError(
      "READ_FAILED",
      `Refusing to read "${resolved}": it is larger than ${maxBytes} bytes.`
    );
  }

  let contents: string;
  let handle: Awaited<ReturnType<typeof open>>;

  try {
    // `O_NOFOLLOW` closes the lstat/read race on POSIX: a file swapped for a
    // symlink between the checks above makes `open` fail instead of following
    // it. Windows may not implement the flag, so the lstat checks stay.
    handle = await open(
      resolved,
      // biome-ignore lint/suspicious/noBitwiseOperators: file open flags are a bitmask.
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
    );
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return undefined;
    }

    throw serviceError("READ_FAILED", `Unable to read "${resolved}".`, error);
  }

  try {
    const openedStats = await handle.stat();

    if (!openedStats.isFile()) {
      throw new CustomerServiceError(
        "READ_FAILED",
        `Refusing to read "${resolved}": it is not a regular file.`
      );
    }

    if (openedStats.size > maxBytes) {
      throw new CustomerServiceError(
        "READ_FAILED",
        `Refusing to read "${resolved}": it is larger than ${maxBytes} bytes.`
      );
    }

    contents = await handle.readFile({ encoding: "utf8" });
  } catch (error) {
    if (error instanceof CustomerServiceError) {
      throw error;
    }

    throw serviceError("READ_FAILED", `Unable to read "${resolved}".`, error);
  } finally {
    await handle.close().catch(() => undefined);
  }

  try {
    return JSON.parse(contents) as unknown;
  } catch (error) {
    throw serviceError(
      "CONFIG_INVALID_JSON",
      `"${resolved}" does not contain valid JSON.`,
      error
    );
  }
}

/**
 * Replaces `targetPath` with `tempPath`. Windows can refuse to `rename` onto an
 * existing file (`EPERM`/`EEXIST`), so the target is moved aside as a backup
 * first and deleted only once the replacement is in place. The target is never
 * removed before the swap: if the replacement fails, the backup is restored, so
 * a failed write loses neither the previous nor the new file.
 */
async function replaceFile(
  tempPath: string,
  targetPath: string
): Promise<void> {
  try {
    await rename(tempPath, targetPath);

    return;
  } catch (error) {
    if (!isErrno(error, "EEXIST", "EPERM")) {
      throw error;
    }
  }

  const backupPath = `${targetPath}.bak-${process.pid}-${randomUUID()}`;
  let backedUp = false;

  try {
    await rename(targetPath, backupPath);
    backedUp = true;
  } catch (error) {
    // ENOENT: the target vanished after the failed rename; nothing to preserve.
    if (!isErrno(error, "ENOENT")) {
      throw error;
    }
  }

  try {
    await rename(tempPath, targetPath);
  } catch (error) {
    if (backedUp) {
      await rename(backupPath, targetPath).catch(() => undefined);
    }

    throw error;
  }

  if (backedUp) {
    await rm(backupPath, { force: true }).catch(() => undefined);
  }
}

export async function writeJsonAtomic(
  filePath: string,
  value: unknown
): Promise<void> {
  const resolved = resolveAbsolutePath(filePath, "WRITE_FAILED", "File path");
  const directory = path.dirname(resolved);
  const baseName = path.basename(resolved);
  const tempPath = path.join(
    directory,
    `.${baseName}.tmp-${process.pid}-${randomUUID()}`
  );

  try {
    const contents = `${JSON.stringify(value, null, 2)}\n`;

    // `wx` (O_CREAT | O_EXCL) refuses to overwrite an existing path, including
    // a symlink planted at the unpredictable temp name.
    await writeFile(tempPath, contents, { flag: "wx", mode: 0o600 });
    await replaceFile(tempPath, resolved);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);

    throw serviceError("WRITE_FAILED", `Unable to write "${resolved}".`, error);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Minimal validity rules for `article_data.json`: a plain object, a schema
 * version of at least one, and a `customer` value that resolves to the folder's
 * numeric customer code (so both `1` and `"0001"` match customer 0001).
 */
function isValidArticleData(value: unknown, customerCode: string): boolean {
  if (!isPlainObject(value)) {
    return false;
  }

  const { customer, schemaVersion } = value;

  if (
    typeof schemaVersion !== "number" ||
    !Number.isInteger(schemaVersion) ||
    schemaVersion < 1
  ) {
    return false;
  }

  const expected = Number(customerCode);

  if (typeof customer === "number") {
    return Number.isFinite(customer) && customer === expected;
  }

  if (typeof customer === "string") {
    return (
      NUMERIC_STRING_PATTERN.test(customer) && Number(customer) === expected
    );
  }

  return false;
}

function truncateIssueMessage(message: string): string {
  if (message.length <= MAX_CUSTOMER_ISSUE_MESSAGE_LENGTH) {
    return message;
  }

  return `${message.slice(0, MAX_CUSTOMER_ISSUE_MESSAGE_LENGTH - 1)}…`;
}

type ArticleEntryKind = "directory" | "other" | "symlink";

/**
 * Some network/FUSE filesystems report `DT_UNKNOWN`, so a `Dirent` can be
 * neither a file, a directory nor a symlink. Falling back to `lstat` keeps
 * article counting correct on those roots (and still never follows links).
 */
async function resolveEntryKind(
  entry: Dirent,
  entryPath: string
): Promise<ArticleEntryKind> {
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

async function isCountableArticle(input: {
  readonly customerCode: string;
  readonly entry: Dirent;
  readonly entryPath: string;
  readonly recordIssue: (issue: CustomerIssue) => void;
}): Promise<boolean> {
  const { customerCode, entry, entryPath, recordIssue } = input;
  const kind = await resolveEntryKind(entry, entryPath);

  if (kind === "symlink") {
    recordIssue({
      code: "ARTICLE_SYMLINK",
      message: `Article folder "${entry.name}" is a symbolic link and was ignored.`,
      path: entryPath,
      severity: "warning",
    });
    return false;
  }

  if (kind !== "directory") {
    return false;
  }

  const articlePath = path.join(entryPath, ARTICLE_FILE_NAME);
  let article: unknown;

  try {
    article = await readJsonFile(articlePath, MAX_ARTICLE_DATA_BYTES);
  } catch (error) {
    recordIssue({
      code: "ARTICLE_INVALID",
      message: `Article folder "${entry.name}" is invalid: ${errorMessage(error)}`,
      path: articlePath,
      severity: "warning",
    });
    return false;
  }

  if (article === undefined) {
    recordIssue({
      code: "ARTICLE_INVALID",
      message: `Article folder "${entry.name}" is missing ${ARTICLE_FILE_NAME}.`,
      path: articlePath,
      severity: "warning",
    });
    return false;
  }

  if (!isValidArticleData(article, customerCode)) {
    recordIssue({
      code: "ARTICLE_INVALID",
      message: `Article folder "${entry.name}" has an invalid ${ARTICLE_FILE_NAME}.`,
      path: articlePath,
      severity: "warning",
    });
    return false;
  }

  return true;
}

function issueSortKey(issue: CustomerIssue): string {
  // NUL cannot occur in paths, codes or messages, so it separates the fields
  // and keeps the ordering path → code → message.
  return `${issue.path ?? ""}\u0000${issue.code}\u0000${issue.message}`;
}

function compareIssues(a: CustomerIssue, b: CustomerIssue): number {
  const left = issueSortKey(a);
  const right = issueSortKey(b);

  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

export async function countValidArticles(
  customerFolderPath: string,
  customerCode: string,
  options: { readonly maxEntries?: number } = {}
): Promise<ArticleCountResult> {
  const resolved = resolveAbsolutePath(
    customerFolderPath,
    "READ_FAILED",
    "Customer folder path"
  );
  const maxEntries = options.maxEntries ?? MAX_ARTICLE_ENTRIES;

  let directory: Awaited<ReturnType<typeof opendir>>;

  try {
    directory = await opendir(resolved);
  } catch (error) {
    throw serviceError(
      "READ_FAILED",
      `Unable to read customer folder "${resolved}".`,
      error
    );
  }

  const issues: CustomerIssue[] = [];
  let issueCount = 0;
  let truncated = false;
  let articleCount = 0;

  const recordIssue = (issue: CustomerIssue): void => {
    // The final slot is kept for the truncation warning, so the returned list
    // never exceeds MAX_ARTICLE_ISSUES entries.
    if (issueCount < MAX_ARTICLE_ISSUES - 1) {
      issues.push({
        ...issue,
        message: truncateIssueMessage(issue.message),
      });
      issueCount += 1;
      return;
    }

    truncated = true;
  };

  try {
    let entryCount = 0;

    for (;;) {
      let entry: Dirent | null;

      try {
        // biome-ignore lint/performance/noAwaitInLoops: entries are inspected sequentially to enforce the budget while streaming.
        entry = await directory.read();
      } catch (error) {
        throw serviceError(
          "READ_FAILED",
          `Unable to read customer folder "${resolved}".`,
          error
        );
      }

      if (entry === null) {
        break;
      }

      entryCount += 1;

      // The budget is enforced while streaming: a full listing is never
      // materialised, and an over-budget folder is abandoned immediately.
      if (entryCount > maxEntries) {
        throw new CustomerServiceError(
          "READ_FAILED",
          `Customer folder "${resolved}" has more than ${maxEntries} entries; the maximum is ${maxEntries}. The article count cannot be determined.`
        );
      }

      if (entry.name.startsWith(".")) {
        continue;
      }

      const entryPath = path.join(resolved, entry.name);
      const countable = await isCountableArticle({
        customerCode,
        entry,
        entryPath,
        recordIssue,
      });

      if (countable) {
        articleCount += 1;
      }
    }
  } finally {
    await directory.close().catch(() => undefined);
  }

  // `opendir` yields entries in filesystem order; sort so the output is stable.
  // When the list was truncated, which issues were kept still depends on that
  // filesystem order — only their order in the result is deterministic.
  issues.sort(compareIssues);

  if (truncated) {
    issues.push({
      code: "ARTICLE_INVALID",
      message: `Too many article issues in "${resolved}"; only the first ${MAX_ARTICLE_ISSUES - 1} were recorded.`,
      path: resolved,
      severity: "warning",
    });
  }

  return { articleCount, issues };
}

/**
 * Translates the generic trash error back into the customer error codes the
 * IPC layer already understands. Messages mirror the pre-refactor ones so the
 * customer contract (codes and explanations) stays stable.
 */
function customerTrashError(
  error: TrashMoveError,
  input: {
    readonly folderName: string;
    readonly sourceFolderPath: string;
    readonly trashDirectory: string;
  }
): CustomerServiceError {
  const { details } = error;
  const sourcePath = details.sourcePath ?? path.resolve(input.sourceFolderPath);
  const trashPath = details.trashPath ?? path.resolve(input.trashDirectory);
  const destination = details.destination ?? "(unknown)";

  switch (error.reason) {
    case "INVALID_FOLDER_NAME":
      return new CustomerServiceError(
        "CUSTOMER_FOLDER_NAME_INVALID",
        `Invalid customer folder name "${input.folderName}".`,
        { cause: error }
      );
    case "SOURCE_NAME_MISMATCH":
      return new CustomerServiceError(
        "CUSTOMER_FOLDER_NAME_INVALID",
        `Customer folder path "${sourcePath}" does not match the folder name "${input.folderName}".`,
        { cause: error }
      );
    case "SOURCE_NOT_FOUND":
      return new CustomerServiceError(
        "CUSTOMER_NOT_FOUND",
        `Customer folder "${sourcePath}" does not exist.`,
        { cause: error }
      );
    case "SOURCE_SYMLINK":
      return new CustomerServiceError(
        "CUSTOMER_FOLDER_SYMLINK",
        `Refusing to move customer folder "${sourcePath}": it is a symbolic link.`,
        { cause: error }
      );
    case "SOURCE_NOT_DIRECTORY":
      return new CustomerServiceError(
        "CUSTOMER_FOLDER_NOT_DIRECTORY",
        `Customer folder "${sourcePath}" is not a directory.`,
        { cause: error }
      );
    case "TRASH_NOT_FOUND":
      return new CustomerServiceError(
        "TRASH_NOT_FOUND",
        `Trash directory "${trashPath}" does not exist.`,
        { cause: error }
      );
    case "TRASH_SYMLINK":
      return new CustomerServiceError(
        "TRASH_SYMLINK",
        `Refusing to use trash directory "${trashPath}": it is a symbolic link.`,
        { cause: error }
      );
    case "TRASH_NOT_DIRECTORY":
      return new CustomerServiceError(
        "TRASH_NOT_DIRECTORY",
        `Trash directory "${trashPath}" is not a directory.`,
        { cause: error }
      );
    case "TRASH_INSIDE_SOURCE":
      return new CustomerServiceError(
        "TRASH_MOVE_FAILED",
        `Refusing to move "${sourcePath}" into a trash directory inside itself ("${trashPath}").`,
        { cause: error }
      );
    case "DESTINATION_OUTSIDE_TRASH":
      return new CustomerServiceError(
        "TRASH_MOVE_FAILED",
        `Destination "${destination}" is outside the trash directory "${trashPath}".`,
        { cause: error }
      );
    case "COPY_FAILED":
      return new CustomerServiceError(
        "TRASH_MOVE_FAILED",
        `Unable to copy "${sourcePath}" to "${destination}".`,
        { cause: error }
      );
    case "SOURCE_REMOVE_FAILED":
      return new CustomerServiceError(
        "TRASH_MOVE_FAILED",
        `Copied "${sourcePath}" to "${destination}" but could not remove the source.`,
        { cause: error }
      );
    default:
      return new CustomerServiceError("TRASH_MOVE_FAILED", error.message, {
        cause: error,
      });
  }
}

/**
 * Moves a customer folder into a trash directory. The generic implementation
 * lives in `src/fs/trash.ts`; this wrapper keeps the customer-facing signature
 * and error codes unchanged.
 */
export async function moveCustomerToTrash(input: {
  folderName: string;
  sourceFolderPath: string;
  trashDirectory: string;
}): Promise<string> {
  try {
    return await moveFolderToTrash(input);
  } catch (error) {
    if (error instanceof TrashMoveError) {
      throw customerTrashError(error, input);
    }

    throw error;
  }
}
