/**
 * Generic trash support shared by customers and articles.
 *
 * The trash root is a configured preference and must already exist as a real
 * directory. Per-type subdirectories (`customers`, `articles`) are created on
 * demand, and a folder is moved with a rename plus an EXDEV copy/remove
 * fallback; its source is removed only after the copy completed. Callers map
 * the reason-based `TrashMoveError` onto their own service error codes.
 */

import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { cp, lstat, mkdir, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";

export const TRASH_MOVE_ERROR_REASONS = [
  "CREATE_FAILED",
  "COPY_FAILED",
  "DESTINATION_OUTSIDE_TRASH",
  "INSPECTION_FAILED",
  "INVALID_FOLDER_NAME",
  "INVALID_PATH",
  "INVALID_SEGMENT",
  "MOVE_FAILED",
  "RESOLVE_FAILED",
  "SOURCE_NAME_MISMATCH",
  "SOURCE_NOT_DIRECTORY",
  "SOURCE_NOT_FOUND",
  "SOURCE_REMOVE_FAILED",
  "SOURCE_SYMLINK",
  "TRASH_INSIDE_SOURCE",
  "TRASH_NOT_DIRECTORY",
  "TRASH_NOT_FOUND",
  "TRASH_SYMLINK",
] as const;

export type TrashMoveErrorReason = (typeof TRASH_MOVE_ERROR_REASONS)[number];

export interface TrashMoveErrorDetails {
  readonly destination?: string;
  readonly folderName?: string;
  readonly path?: string;
  readonly segment?: string;
  readonly sourcePath?: string;
  readonly trashPath?: string;
}

interface TrashMoveErrorOptions {
  cause?: unknown;
  details?: TrashMoveErrorDetails;
}

export class TrashMoveError extends Error {
  readonly details: TrashMoveErrorDetails;

  readonly reason: TrashMoveErrorReason;

  constructor(
    reason: TrashMoveErrorReason,
    message: string,
    options: TrashMoveErrorOptions = {}
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = "TrashMoveError";
    this.reason = reason;
    this.details = options.details ?? {};
  }
}

/**
 * Keeps the `throw` out of catch blocks, so the original failure can be
 * forwarded as `cause` without the linter losing track of it.
 */
function trashError(
  reason: TrashMoveErrorReason,
  message: string,
  options: TrashMoveErrorOptions = {}
): TrashMoveError {
  return new TrashMoveError(reason, message, options);
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

async function lstatIfExists(filePath: string): Promise<Stats | undefined> {
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

/**
 * Resolves a path supplied by a caller. Every filesystem entry point in this
 * module requires an absolute path, so a relative value (which resolves
 * differently in development and packaged builds) or an embedded NUL is
 * rejected before it can reach the filesystem.
 */
function resolveAbsolutePath(filePath: string, label: string): string {
  if (filePath.includes("\0")) {
    throw trashError(
      "INVALID_PATH",
      `${label} contains a NUL character: "${filePath}".`
    );
  }

  if (!path.isAbsolute(filePath)) {
    throw trashError(
      "INVALID_PATH",
      `${label} must be an absolute path (received "${filePath}").`
    );
  }

  return path.resolve(filePath);
}

/**
 * True when `child` is `parent` itself or lives strictly underneath it. Both
 * paths are resolved first, and the relative result is inspected instead of
 * string prefixes, so `/a/bc` is not treated as a child of `/a/b`. On Windows
 * a relative path on another drive is absolute, which also fails the check.
 */
function isPathInside(parent: string, child: string): boolean {
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

function isSinglePathComponent(value: string): boolean {
  return (
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("\0")
  );
}

async function inspect(
  filePath: string,
  label: string
): Promise<Stats | undefined> {
  try {
    return await lstatIfExists(filePath);
  } catch (error) {
    throw trashError(
      "INSPECTION_FAILED",
      `Unable to inspect ${label.toLowerCase()} "${filePath}".`,
      { cause: error, details: { path: filePath } }
    );
  }
}

async function assertTrashDirectory(trashPath: string): Promise<void> {
  const stats = await inspect(trashPath, "Trash directory");

  if (!stats) {
    throw trashError(
      "TRASH_NOT_FOUND",
      `Trash directory "${trashPath}" does not exist.`,
      { details: { trashPath } }
    );
  }

  if (stats.isSymbolicLink()) {
    throw trashError(
      "TRASH_SYMLINK",
      `Refusing to use trash directory "${trashPath}": it is a symbolic link.`,
      { details: { trashPath } }
    );
  }

  if (!stats.isDirectory()) {
    throw trashError(
      "TRASH_NOT_DIRECTORY",
      `Trash directory "${trashPath}" is not a directory.`,
      { details: { trashPath } }
    );
  }
}

function assertTrashSubdirectoryStats(
  trashPath: string,
  current: string,
  segment: string,
  stats: Stats
): void {
  if (stats.isSymbolicLink()) {
    throw trashError(
      "TRASH_SYMLINK",
      `Refusing to use trash subdirectory "${current}": it is a symbolic link.`,
      { details: { destination: current, segment, trashPath } }
    );
  }

  if (!stats.isDirectory()) {
    throw trashError(
      "TRASH_NOT_DIRECTORY",
      `Trash subdirectory "${current}" is not a directory.`,
      { details: { destination: current, segment, trashPath } }
    );
  }
}

async function createTrashSubdirectory(
  trashPath: string,
  current: string,
  segment: string
): Promise<void> {
  try {
    await mkdir(current, { mode: 0o755 });
  } catch (error) {
    if (!isErrno(error, "EEXIST")) {
      throw trashError(
        "CREATE_FAILED",
        `Unable to create trash subdirectory "${current}": ${errorMessage(error)}`,
        {
          cause: error,
          details: { destination: current, segment, trashPath },
        }
      );
    }

    // Lost a race with another creator: re-check what appeared.
    const raced = await inspect(current, "Trash subdirectory");

    if (!raced) {
      throw trashError(
        "CREATE_FAILED",
        `Unable to create trash subdirectory "${current}".`,
        {
          cause: error,
          details: { destination: current, segment, trashPath },
        }
      );
    }

    assertTrashSubdirectoryStats(trashPath, current, segment, raced);
  }
}

async function ensureTrashSegment(
  trashPath: string,
  parent: string,
  segment: string
): Promise<string> {
  if (!isSinglePathComponent(segment)) {
    throw trashError(
      "INVALID_SEGMENT",
      `Invalid trash subdirectory name "${segment}".`,
      { details: { segment, trashPath } }
    );
  }

  const current = path.join(parent, segment);

  if (!isPathInside(trashPath, current)) {
    throw trashError(
      "DESTINATION_OUTSIDE_TRASH",
      `Trash subdirectory "${current}" is outside the trash directory "${trashPath}".`,
      { details: { destination: current, segment, trashPath } }
    );
  }

  const existing = await inspect(current, "Trash subdirectory");

  if (existing) {
    assertTrashSubdirectoryStats(trashPath, current, segment, existing);

    return current;
  }

  await createTrashSubdirectory(trashPath, current, segment);

  return current;
}

/**
 * Resolves the trash root, validates it, then creates (mode 0755) and returns
 * the subdirectory identified by `segments`. Every existing component is
 * checked with `lstat` so a symlink or a plain file is refused instead of being
 * followed or overwritten.
 */
export async function ensureTrashSubdirectory(
  trashDirectory: string,
  ...segments: readonly string[]
): Promise<string> {
  const trashPath = resolveAbsolutePath(trashDirectory, "Trash directory");

  await assertTrashDirectory(trashPath);

  let current = trashPath;

  for (const segment of segments) {
    // biome-ignore lint/performance/noAwaitInLoops: each component must be created before the next one is inspected.
    current = await ensureTrashSegment(trashPath, current, segment);
  }

  return current;
}

/**
 * Picks a free destination name: the plain folder name first, then a
 * timestamped variant, then numbered suffixes. Probing is bounded; after 1,000
 * collisions a random suffix is used, and if even that exists the move fails
 * instead of scanning the directory forever.
 */
const MAX_COLLISION_SUFFIX = 1000;

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

  for (let counter = 1; counter <= MAX_COLLISION_SUFFIX; counter += 1) {
    const candidate = `${stamped}-${counter}`;

    // biome-ignore lint/performance/noAwaitInLoops: collision suffixes must be probed one at a time.
    if (!(await lstatIfExists(candidate))) {
      return candidate;
    }
  }

  const randomized = `${base}-${Date.now()}-${randomUUID()}`;

  if (!(await lstatIfExists(randomized))) {
    return randomized;
  }

  throw trashError(
    "MOVE_FAILED",
    `Unable to choose a free destination for "${folderName}" in "${trashDirectory}".`,
    { details: { folderName, trashPath: trashDirectory } }
  );
}

/**
 * Cross-device fallback: copy first, remove the source only after the copy
 * completed, so an interrupted move can never lose the folder.
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
    throw trashError(
      "COPY_FAILED",
      `Unable to copy "${source}" to "${destination}".`,
      { cause: error, details: { destination, sourcePath: source } }
    );
  }

  try {
    await rm(source, { force: false, recursive: true });
  } catch (error) {
    throw trashError(
      "SOURCE_REMOVE_FAILED",
      `Copied "${source}" to "${destination}" but could not remove the source.`,
      { cause: error, details: { destination, sourcePath: source } }
    );
  }
}

/**
 * Moves a folder into an already existing trash directory. The returned value
 * is the final destination, which may carry a collision suffix.
 */
export async function moveFolderToTrash(input: {
  folderName: string;
  sourceFolderPath: string;
  trashDirectory: string;
}): Promise<string> {
  const { folderName, sourceFolderPath, trashDirectory } = input;

  if (!isSinglePathComponent(folderName)) {
    throw trashError(
      "INVALID_FOLDER_NAME",
      `Invalid folder name "${folderName}".`,
      { details: { folderName } }
    );
  }

  const trashPath = resolveAbsolutePath(trashDirectory, "Trash directory");
  const sourcePath = resolveAbsolutePath(sourceFolderPath, "Folder path");

  await assertTrashDirectory(trashPath);

  const sourceStats = await inspect(sourcePath, "Source folder");

  if (!sourceStats) {
    throw trashError(
      "SOURCE_NOT_FOUND",
      `Folder "${sourcePath}" does not exist.`,
      { details: { sourcePath, trashPath } }
    );
  }

  if (sourceStats.isSymbolicLink()) {
    throw trashError(
      "SOURCE_SYMLINK",
      `Refusing to move folder "${sourcePath}": it is a symbolic link.`,
      { details: { sourcePath, trashPath } }
    );
  }

  if (!sourceStats.isDirectory()) {
    throw trashError(
      "SOURCE_NOT_DIRECTORY",
      `Folder "${sourcePath}" is not a directory.`,
      { details: { sourcePath, trashPath } }
    );
  }

  if (path.basename(sourcePath) !== folderName) {
    throw trashError(
      "SOURCE_NAME_MISMATCH",
      `Folder path "${sourcePath}" does not match the folder name "${folderName}".`,
      { details: { folderName, sourcePath, trashPath } }
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
    throw trashError(
      "RESOLVE_FAILED",
      `Unable to resolve "${sourcePath}" and "${trashPath}".`,
      { cause: error, details: { sourcePath, trashPath } }
    );
  }

  // Moving a folder into a subdirectory of itself would make the destination
  // disappear together with the source.
  if (realSource === realTrash || isPathInside(realSource, realTrash)) {
    throw trashError(
      "TRASH_INSIDE_SOURCE",
      `Refusing to move "${sourcePath}" into a trash directory inside itself ("${trashPath}").`,
      { details: { sourcePath, trashPath } }
    );
  }

  let destination: string;

  try {
    destination = await freeDestination(trashPath, folderName);
  } catch (error) {
    // A probing failure is reported as INSPECTION_FAILED, but a destination
    // that cannot be freed at all keeps its own MOVE_FAILED reason so the
    // documented contract is observable to callers.
    if (error instanceof TrashMoveError) {
      throw error;
    }

    throw trashError(
      "INSPECTION_FAILED",
      `Unable to choose a trash destination for "${sourcePath}".`,
      { cause: error, details: { sourcePath, trashPath } }
    );
  }

  if (!isPathInside(trashPath, destination)) {
    throw trashError(
      "DESTINATION_OUTSIDE_TRASH",
      `Destination "${destination}" is outside the trash directory "${trashPath}".`,
      { details: { destination, sourcePath, trashPath } }
    );
  }

  // The lexical check above can be defeated by an ancestor trash directory: the
  // resolved destination parent must be the trash directory that was validated
  // and resolved at the start of this call.
  let realDestinationParent: string;

  try {
    realDestinationParent = await realpath(path.dirname(destination));
  } catch (error) {
    throw trashError(
      "DESTINATION_OUTSIDE_TRASH",
      `Unable to resolve the parent of destination "${destination}".`,
      { cause: error, details: { destination, sourcePath, trashPath } }
    );
  }

  if (realDestinationParent !== realTrash) {
    throw trashError(
      "DESTINATION_OUTSIDE_TRASH",
      `Destination "${destination}" does not resolve inside the trash directory "${trashPath}".`,
      { details: { destination, sourcePath, trashPath } }
    );
  }

  try {
    await rename(sourcePath, destination);
  } catch (error) {
    if (!isErrno(error, "EXDEV")) {
      throw trashError(
        "MOVE_FAILED",
        `Unable to move "${sourcePath}" to "${destination}".`,
        { cause: error, details: { destination, sourcePath, trashPath } }
      );
    }

    await copyThenRemove(sourcePath, destination);
  }

  return destination;
}
