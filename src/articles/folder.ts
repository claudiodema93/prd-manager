/**
 * Filesystem guards and readers for the article domain.
 *
 * Layout: `<root>/customer-XXXX/<article-folder>/article_data.json`. Every
 * caller-supplied path is resolved, NUL-checked and confined to its expected
 * parent; directories are inspected with `lstat` so a symlink is never
 * followed. Reads use `O_NOFOLLOW` on POSIX to close the lstat/open race.
 */

import { constants, type Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import {
  MAX_ARTICLE_DATA_BYTES,
  parseCustomerFolderName,
} from "../customers/folder";
import { type ArticleErrorCode, ArticleServiceError } from "./errors";

export const ARTICLE_DATA_FILE_NAME = "article_data.json";

const MAX_FOLDER_NAME_BYTES = 255;
const RESERVED_CHARACTERS: ReadonlySet<string> = new Set([
  ":",
  "*",
  "?",
  '"',
  "<",
  ">",
  "|",
]);
const WINDOWS_RESERVED_NAME_PATTERN =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

export interface CustomerFolderLocation {
  readonly customerCode: string;
  readonly customerFolderName: string;
  readonly customerFolderPath: string;
}

export interface ArticleFolderLocation {
  readonly articleFolderName: string;
  readonly articleFolderPath: string;
  readonly customerCode: string;
  readonly customerFolderName: string;
  readonly customerFolderPath: string;
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
 * Keeps the `throw` out of catch blocks so the original failure can be
 * forwarded as `cause` without the linter losing track of it.
 */
function articleError(
  code: ArticleErrorCode,
  message: string,
  cause?: unknown
): ArticleServiceError {
  return new ArticleServiceError(code, message, { cause });
}

/**
 * Resolves a caller-supplied path. Relative paths are refused because they
 * resolve differently in development and packaged builds.
 */
function resolveAbsolutePath(
  filePath: string,
  code: "ARTICLE_DATA_UNREADABLE" | "ARTICLE_PATH_INVALID",
  label: string
): string {
  if (filePath.includes("\0")) {
    throw new ArticleServiceError(
      code,
      `${label} contains a NUL character: "${filePath}".`
    );
  }

  if (!path.isAbsolute(filePath)) {
    throw new ArticleServiceError(
      code,
      `${label} must be an absolute path (received "${filePath}").`
    );
  }

  return path.resolve(filePath);
}

/**
 * True when `child` is `parent` itself or lives strictly underneath it. Resolved
 * paths and a relative-path check avoid the `/a/bc` prefix trap.
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

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

export async function lstatIfExists(
  filePath: string
): Promise<Stats | undefined> {
  try {
    // `throwIfNoEntry: false` is honoured by the sync API; recent Node
    // releases still reject the promises variant with ENOENT, so it is
    // swallowed here as well.
    const stats = await lstat(filePath, { throwIfNoEntry: false });

    return stats as Stats | undefined;
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}

async function inspect(
  filePath: string,
  label: string
): Promise<Stats | undefined> {
  const resolved = resolveAbsolutePath(filePath, "ARTICLE_PATH_INVALID", label);

  try {
    return await lstatIfExists(resolved);
  } catch (error) {
    throw articleError(
      "READ_FAILED",
      `Unable to inspect ${label.toLowerCase()} "${resolved}".`,
      error
    );
  }
}

/**
 * Confines a customer folder to a direct child of the root. The root itself is
 * not a customer folder and is rejected too.
 */
export function assertCustomerFolderPath(
  rootDirectory: string,
  customerFolderPath: string
): CustomerFolderLocation {
  const root = resolveAbsolutePath(
    rootDirectory,
    "ARTICLE_PATH_INVALID",
    "Articles directory"
  );
  const resolved = resolveAbsolutePath(
    customerFolderPath,
    "ARTICLE_PATH_INVALID",
    "Customer folder path"
  );
  const parent = path.dirname(resolved);

  if (resolved === root || !samePath(parent, root)) {
    throw new ArticleServiceError(
      "ARTICLE_PATH_INVALID",
      `Customer folder "${resolved}" must be a direct child of the articles directory "${root}".`
    );
  }

  const customerFolderName = path.basename(resolved);
  const parsed = parseCustomerFolderName(customerFolderName);

  if (!parsed) {
    throw new ArticleServiceError(
      "ARTICLE_PATH_INVALID",
      `"${customerFolderName}" is not a valid customer folder name.`
    );
  }

  return {
    customerCode: parsed.customerCode,
    customerFolderName,
    customerFolderPath: resolved,
  };
}

/**
 * Confines an article folder to a direct child of a `customer-XXXX` folder that
 * is itself a direct child of the root.
 */
export function assertArticleFolderPath(
  rootDirectory: string,
  articleFolderPath: string
): ArticleFolderLocation {
  const root = resolveAbsolutePath(
    rootDirectory,
    "ARTICLE_PATH_INVALID",
    "Articles directory"
  );
  const resolved = resolveAbsolutePath(
    articleFolderPath,
    "ARTICLE_PATH_INVALID",
    "Article folder path"
  );
  const customerFolderPath = path.dirname(resolved);
  const customerParent = path.dirname(customerFolderPath);

  if (!samePath(customerParent, root) || resolved === customerFolderPath) {
    throw new ArticleServiceError(
      "ARTICLE_PATH_INVALID",
      `Article folder "${resolved}" must be a direct child of a customer folder inside "${root}".`
    );
  }

  const customerFolderName = path.basename(customerFolderPath);
  const parsed = parseCustomerFolderName(customerFolderName);

  if (!parsed) {
    throw new ArticleServiceError(
      "ARTICLE_PATH_INVALID",
      `"${customerFolderName}" is not a valid customer folder name.`
    );
  }

  const articleFolderName = path.basename(resolved);

  return {
    articleFolderName,
    articleFolderPath: resolved,
    customerCode: parsed.customerCode,
    customerFolderName,
    customerFolderPath,
  };
}

/**
 * Validates a rendered key before it is used as a directory name. The key
 * renderer already enforces these rules; this guard protects callers that build
 * a name directly.
 */
export function isSafeArticleFolderName(name: string): boolean {
  if (name.length < 1 || name.startsWith(".")) {
    return false;
  }

  if (Buffer.byteLength(name, "utf8") > MAX_FOLDER_NAME_BYTES) {
    return false;
  }

  for (const character of name) {
    const code = character.codePointAt(0) ?? 0;

    if (code < 0x20 || code === 0x7f) {
      return false;
    }

    if (character === "/" || character === "\\") {
      return false;
    }

    if (RESERVED_CHARACTERS.has(character)) {
      return false;
    }
  }

  if (name.endsWith(" ") || name.endsWith(".")) {
    return false;
  }

  const dotIndex = name.indexOf(".");
  const basename = dotIndex === -1 ? name : name.slice(0, dotIndex);

  return !WINDOWS_RESERVED_NAME_PATTERN.test(basename);
}

export function assertSafeArticleFolderName(name: string): string {
  if (!isSafeArticleFolderName(name)) {
    throw new ArticleServiceError(
      "ARTICLE_FOLDER_NAME_INVALID",
      `Invalid article folder name "${name}".`
    );
  }

  return name;
}

export async function assertCustomerFolderDirectory(
  customerFolderPath: string
): Promise<void> {
  const stats = await inspect(customerFolderPath, "Customer folder");

  if (!stats) {
    throw new ArticleServiceError(
      "ARTICLE_CUSTOMER_NOT_FOUND",
      `Customer folder "${customerFolderPath}" does not exist.`
    );
  }

  if (stats.isSymbolicLink()) {
    throw new ArticleServiceError(
      "ARTICLE_CUSTOMER_SYMLINK",
      `Refusing to use customer folder "${customerFolderPath}": it is a symbolic link.`
    );
  }

  if (!stats.isDirectory()) {
    throw new ArticleServiceError(
      "ARTICLE_CUSTOMER_NOT_DIRECTORY",
      `Customer folder "${customerFolderPath}" is not a directory.`
    );
  }
}

export async function assertArticleFolderDirectory(
  articleFolderPath: string
): Promise<void> {
  const stats = await inspect(articleFolderPath, "Article folder");

  if (!stats) {
    throw new ArticleServiceError(
      "ARTICLE_NOT_FOUND",
      `Article folder "${articleFolderPath}" does not exist.`
    );
  }

  if (stats.isSymbolicLink()) {
    throw new ArticleServiceError(
      "ARTICLE_FOLDER_SYMLINK",
      `Refusing to use article folder "${articleFolderPath}": it is a symbolic link.`
    );
  }

  if (!stats.isDirectory()) {
    throw new ArticleServiceError(
      "ARTICLE_FOLDER_NOT_DIRECTORY",
      `Article folder "${articleFolderPath}" is not a directory.`
    );
  }
}

/**
 * Cheap change detector for the scanner: the newest mtime of the article folder
 * and its data file, floored to whole milliseconds (0 when both are missing).
 */
export async function articleFolderFingerprint(
  articleFolderPath: string
): Promise<number> {
  const dataPath = path.join(articleFolderPath, ARTICLE_DATA_FILE_NAME);
  const [folderStats, dataStats] = await Promise.all([
    lstatIfExists(articleFolderPath).catch(() => undefined),
    lstatIfExists(dataPath).catch(() => undefined),
  ]);
  const newest = Math.max(folderStats?.mtimeMs ?? 0, dataStats?.mtimeMs ?? 0);

  return Math.floor(newest);
}

/**
 * Reads and parses `article_data.json`. Missing, unreadable and oversized files
 * are distinguished so the caller can report the right article error code.
 */
export async function readArticleDataFile(filePath: string): Promise<unknown> {
  const resolved = resolveAbsolutePath(
    filePath,
    "ARTICLE_DATA_UNREADABLE",
    "Article data path"
  );

  let stats: Stats | undefined;

  try {
    stats = await lstatIfExists(resolved);
  } catch (error) {
    throw articleError(
      "ARTICLE_DATA_UNREADABLE",
      `Unable to inspect "${resolved}".`,
      error
    );
  }

  if (!stats) {
    throw new ArticleServiceError(
      "ARTICLE_DATA_MISSING",
      `"${resolved}" does not exist.`
    );
  }

  if (stats.isSymbolicLink()) {
    throw new ArticleServiceError(
      "ARTICLE_DATA_UNREADABLE",
      `Refusing to read "${resolved}": it is a symbolic link.`
    );
  }

  if (!stats.isFile()) {
    throw new ArticleServiceError(
      "ARTICLE_DATA_UNREADABLE",
      `Refusing to read "${resolved}": it is not a regular file.`
    );
  }

  if (stats.size > MAX_ARTICLE_DATA_BYTES) {
    throw new ArticleServiceError(
      "ARTICLE_DATA_UNREADABLE",
      `Refusing to read "${resolved}": it is larger than ${MAX_ARTICLE_DATA_BYTES} bytes.`
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
      throw articleError(
        "ARTICLE_DATA_MISSING",
        `"${resolved}" does not exist.`,
        error
      );
    }

    throw articleError(
      "ARTICLE_DATA_UNREADABLE",
      `Unable to read "${resolved}".`,
      error
    );
  }

  try {
    const openedStats = await handle.stat();

    if (!openedStats.isFile()) {
      throw new ArticleServiceError(
        "ARTICLE_DATA_UNREADABLE",
        `Refusing to read "${resolved}": it is not a regular file.`
      );
    }

    if (openedStats.size > MAX_ARTICLE_DATA_BYTES) {
      throw new ArticleServiceError(
        "ARTICLE_DATA_UNREADABLE",
        `Refusing to read "${resolved}": it is larger than ${MAX_ARTICLE_DATA_BYTES} bytes.`
      );
    }

    contents = await handle.readFile({ encoding: "utf8" });
  } catch (error) {
    if (error instanceof ArticleServiceError) {
      throw error;
    }

    throw articleError(
      "ARTICLE_DATA_UNREADABLE",
      `Unable to read "${resolved}".`,
      error
    );
  } finally {
    await handle.close().catch(() => undefined);
  }

  try {
    return JSON.parse(contents) as unknown;
  } catch (error) {
    throw articleError(
      "ARTICLE_DATA_INVALID_JSON",
      `"${resolved}" does not contain valid JSON: ${errorMessage(error)}`,
      error
    );
  }
}
