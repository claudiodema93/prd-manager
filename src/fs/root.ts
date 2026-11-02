/**
 * Shared validation of the configured articles root.
 *
 * Customer and article services both need the same four checks: the preference
 * is configured, the path exists, it is not a symbolic link, and it is a real
 * directory. The reason-based error keeps this module free of a domain error
 * type; each service maps the reason onto its own public error codes so its IPC
 * contract does not change.
 */

import type { Stats } from "node:fs";
import { lstat } from "node:fs/promises";
import path from "node:path";

export const ROOT_DIRECTORY_ERROR_REASONS = [
  "NOT_CONFIGURED",
  "NOT_FOUND",
  "SYMLINK",
  "NOT_DIRECTORY",
] as const;

export type RootDirectoryErrorReason =
  (typeof ROOT_DIRECTORY_ERROR_REASONS)[number];

export class RootDirectoryError extends Error {
  readonly reason: RootDirectoryErrorReason;

  constructor(
    reason: RootDirectoryErrorReason,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "RootDirectoryError";
    this.reason = reason;
  }
}

function isErrno(error: unknown, ...codes: readonly string[]): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const { code } = error as { code?: unknown };

  return typeof code === "string" && codes.includes(code);
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
 * Resolves and validates the configured articles directory.
 *
 * The returned path is absolute. A missing preference is distinct from a
 * missing directory, so callers can report an actionable precondition error
 * instead of treating the root as "no customers/articles".
 */
export async function assertConfiguredRoot(
  rootDirectory: string | null
): Promise<string> {
  if (rootDirectory === null) {
    throw new RootDirectoryError(
      "NOT_CONFIGURED",
      "The articles directory is not configured."
    );
  }

  if (rootDirectory.includes("\0")) {
    // No filesystem path can contain NUL, so report it as absent rather than
    // letting it reach `lstat`.
    throw new RootDirectoryError(
      "NOT_FOUND",
      `Articles directory "${rootDirectory}" does not exist.`
    );
  }

  const root = path.resolve(rootDirectory);
  const stats = await lstatIfExists(root);

  if (!stats) {
    throw new RootDirectoryError(
      "NOT_FOUND",
      `Articles directory "${root}" does not exist.`
    );
  }

  if (stats.isSymbolicLink()) {
    throw new RootDirectoryError(
      "SYMLINK",
      `Refusing to use articles directory "${root}": it is a symbolic link.`
    );
  }

  if (!stats.isDirectory()) {
    throw new RootDirectoryError(
      "NOT_DIRECTORY",
      `Articles directory "${root}" is not a directory.`
    );
  }

  return root;
}
