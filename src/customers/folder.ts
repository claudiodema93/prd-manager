import { randomUUID } from "node:crypto";
import { constants, type Dirent, type Stats } from "node:fs";
import {
  cp,
  lstat,
  open,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
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

    try {
      await rename(tempPath, resolved);
    } catch (error) {
      // Windows refuses to replace an existing file with `rename`.
      if (!isErrno(error, "EEXIST", "EPERM")) {
        throw error;
      }

      await rm(resolved, { force: true });
      await rename(tempPath, resolved);
    }
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

function compareEntryNames(left: Dirent, right: Dirent): number {
  if (left.name === right.name) {
    return 0;
  }

  return left.name < right.name ? -1 : 1;
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

  let entries: Dirent[];

  try {
    entries = await readdir(resolved, { withFileTypes: true });
  } catch (error) {
    throw serviceError(
      "READ_FAILED",
      `Unable to read customer folder "${resolved}".`,
      error
    );
  }

  entries.sort(compareEntryNames);

  const maxEntries = options.maxEntries ?? MAX_ARTICLE_ENTRIES;

  if (entries.length > maxEntries) {
    throw new CustomerServiceError(
      "READ_FAILED",
      `Customer folder "${resolved}" has ${entries.length} entries; the maximum is ${maxEntries}. The article count cannot be determined.`
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

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const entryPath = path.join(resolved, entry.name);

    // biome-ignore lint/performance/noAwaitInLoops: entries are inspected sequentially to keep issue order deterministic.
    const kind = await resolveEntryKind(entry, entryPath);

    if (kind === "symlink") {
      recordIssue({
        code: "ARTICLE_SYMLINK",
        message: `Article folder "${entry.name}" is a symbolic link and was ignored.`,
        path: entryPath,
        severity: "warning",
      });
      continue;
    }

    if (kind !== "directory") {
      continue;
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
      continue;
    }

    if (article === undefined) {
      recordIssue({
        code: "ARTICLE_INVALID",
        message: `Article folder "${entry.name}" is missing ${ARTICLE_FILE_NAME}.`,
        path: articlePath,
        severity: "warning",
      });
      continue;
    }

    if (!isValidArticleData(article, customerCode)) {
      recordIssue({
        code: "ARTICLE_INVALID",
        message: `Article folder "${entry.name}" has an invalid ${ARTICLE_FILE_NAME}.`,
        path: articlePath,
        severity: "warning",
      });
      continue;
    }

    articleCount += 1;
  }

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

async function inspect(
  filePath: string,
  code: CustomerErrorCode,
  label: string
): Promise<Stats | undefined> {
  try {
    return await lstatIfExists(filePath);
  } catch (error) {
    throw serviceError(
      code,
      `Unable to inspect ${label.toLowerCase()} "${filePath}".`,
      error
    );
  }
}

/**
 * Picks a free destination name: the plain folder name first, then a
 * timestamped variant, then numbered suffixes until an unused path is found.
 */
async function freeDestination(
  trashDirectory: string,
  folderName: string
): Promise<string> {
  const base = path.join(trashDirectory, folderName);

  if (!(await lstatIfExists(base))) {
    return base;
  }

  const stamped = `${base}-${Date.now()}`;

  if (!(await lstatIfExists(stamped))) {
    return stamped;
  }

  let counter = 1;

  for (;;) {
    const candidate = `${stamped}-${counter}`;

    // biome-ignore lint/performance/noAwaitInLoops: collision suffixes must be probed one at a time.
    if (!(await lstatIfExists(candidate))) {
      return candidate;
    }

    counter += 1;
  }
}

/**
 * Cross-device fallback: copy first, remove the source only after the copy
 * completed, so an interrupted move can never lose the customer folder.
 */
async function copyThenRemove(
  source: string,
  destination: string
): Promise<void> {
  try {
    await cp(source, destination, {
      dereference: false,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      recursive: true,
    });
  } catch (error) {
    throw serviceError(
      "TRASH_MOVE_FAILED",
      `Unable to copy "${source}" to "${destination}".`,
      error
    );
  }

  try {
    await rm(source, { force: false, recursive: true });
  } catch (error) {
    throw serviceError(
      "TRASH_MOVE_FAILED",
      `Copied "${source}" to "${destination}" but could not remove the source.`,
      error
    );
  }
}

export async function moveCustomerToTrash(input: {
  folderName: string;
  sourceFolderPath: string;
  trashDirectory: string;
}): Promise<string> {
  const { folderName, sourceFolderPath, trashDirectory } = input;

  if (
    folderName.length === 0 ||
    folderName === "." ||
    folderName === ".." ||
    folderName.includes("/") ||
    folderName.includes("\\") ||
    folderName.includes("\0")
  ) {
    throw new CustomerServiceError(
      "CUSTOMER_FOLDER_NAME_INVALID",
      `Invalid customer folder name "${folderName}".`
    );
  }

  const trashPath = resolveAbsolutePath(
    trashDirectory,
    "TRASH_MOVE_FAILED",
    "Trash directory"
  );
  const sourcePath = resolveAbsolutePath(
    sourceFolderPath,
    "TRASH_MOVE_FAILED",
    "Customer folder path"
  );

  const trashStats = await inspect(
    trashPath,
    "TRASH_MOVE_FAILED",
    "Trash directory"
  );

  if (!trashStats) {
    throw new CustomerServiceError(
      "TRASH_NOT_FOUND",
      `Trash directory "${trashPath}" does not exist.`
    );
  }

  if (trashStats.isSymbolicLink()) {
    throw new CustomerServiceError(
      "TRASH_SYMLINK",
      `Refusing to use trash directory "${trashPath}": it is a symbolic link.`
    );
  }

  if (!trashStats.isDirectory()) {
    throw new CustomerServiceError(
      "TRASH_NOT_DIRECTORY",
      `Trash directory "${trashPath}" is not a directory.`
    );
  }

  const sourceStats = await inspect(
    sourcePath,
    "TRASH_MOVE_FAILED",
    "Customer folder"
  );

  if (!sourceStats) {
    throw new CustomerServiceError(
      "CUSTOMER_NOT_FOUND",
      `Customer folder "${sourcePath}" does not exist.`
    );
  }

  if (sourceStats.isSymbolicLink()) {
    throw new CustomerServiceError(
      "CUSTOMER_FOLDER_SYMLINK",
      `Refusing to move customer folder "${sourcePath}": it is a symbolic link.`
    );
  }

  if (!sourceStats.isDirectory()) {
    throw new CustomerServiceError(
      "CUSTOMER_FOLDER_NOT_DIRECTORY",
      `Customer folder "${sourcePath}" is not a directory.`
    );
  }

  let realSource: string;
  let realTrash: string;

  try {
    [realSource, realTrash] = await Promise.all([
      realpath(sourcePath),
      realpath(trashPath),
    ]);
  } catch (error) {
    throw serviceError(
      "TRASH_MOVE_FAILED",
      `Unable to resolve "${sourcePath}" and "${trashPath}".`,
      error
    );
  }

  // Moving a folder into a subdirectory of itself would make the destination
  // disappear together with the source.
  if (realSource === realTrash || isPathInside(realSource, realTrash)) {
    throw new CustomerServiceError(
      "TRASH_MOVE_FAILED",
      `Refusing to move "${sourcePath}" into a trash directory inside itself ("${trashPath}").`
    );
  }

  const destination = await freeDestination(trashPath, folderName);

  if (!isPathInside(trashPath, destination)) {
    throw new CustomerServiceError(
      "TRASH_MOVE_FAILED",
      `Destination "${destination}" is outside the trash directory "${trashPath}".`
    );
  }

  try {
    await rename(sourcePath, destination);
  } catch (error) {
    if (!isErrno(error, "EXDEV")) {
      throw serviceError(
        "TRASH_MOVE_FAILED",
        `Unable to move "${sourcePath}" to "${destination}".`,
        error
      );
    }

    await copyThenRemove(sourcePath, destination);
  }

  return destination;
}
