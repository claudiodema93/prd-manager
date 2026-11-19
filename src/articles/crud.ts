/**
 * Filesystem-first CRUD for customer articles.
 *
 * `article_data.json` and the article folder are the source of truth; the
 * SQLite `articles` table is only a cache. Every exported operation therefore
 * validates the filesystem state, performs the filesystem change, and only then
 * updates the cache row. The operations are serialised through
 * `withCustomerLock` so a concurrent scan cannot observe a half-written folder,
 * and they intentionally never call a scanner themselves (the lock is not
 * re-entrant).
 */

import { mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import {
  MAX_CUSTOMER_CONFIG_BYTES,
  parseCustomerConfig,
} from "../customers/config";
import { CustomerServiceError } from "../customers/errors";
import {
  countValidArticles,
  MAX_ARTICLE_DATA_BYTES,
  readJsonFile,
  writeJsonAtomic,
} from "../customers/folder";
import {
  type ResolvedKeyTemplate,
  resolveKeyTemplate,
} from "../customers/key-template";
import { withCustomerLock } from "../customers/lock";
import { getCustomerRow, upsertCustomerRow } from "../customers/store";
import type {
  CustomerCacheMetadata,
  CustomerConfig,
  ParameterDefinitions,
} from "../customers/types";
import { assertConfiguredRoot, RootDirectoryError } from "../fs/root";
import {
  ensureTrashSubdirectory,
  moveFolderToTrash,
  TrashMoveError,
} from "../fs/trash";
import {
  ARTICLE_SCHEMA_VERSION,
  type ArticleConfig,
  articleConfigDocument,
  MAX_ARTICLE_CUSTOM_PARAMETERS,
  MAX_ARTICLE_CUSTOM_VALUE_LENGTH,
  parseArticleConfig,
  serializeArticleConfig,
} from "./config";
import { ArticleServiceError } from "./errors";
import {
  ARTICLE_DATA_FILE_NAME,
  articleFolderFingerprint,
  assertArticleFolderDirectory,
  assertArticleFolderPath,
  assertCustomerFolderDirectory,
  assertCustomerFolderPath,
  assertSafeArticleFolderName,
  isPathInside,
  lstatIfExists,
  readArticleDataFile,
} from "./folder";
import { countValidRevisions } from "./revisions";
import {
  type ArticleDatabase,
  type ArticleRecord,
  deleteArticleRow,
  upsertArticleRow,
} from "./store";
import type { ArticleCustomValue } from "./types";

const CUSTOMER_CONFIG_FILE_NAME = "customer_data.json";
const ARTICLE_TRASH_SEGMENT = "articles";
const PARAMETER_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;

const RESERVED_CUSTOM_PARAMETER_NAMES: ReadonlySet<string> = new Set([
  "activeRevision",
  "customer",
  "schemaVersion",
]);

export type ArticleParameterValues = Readonly<
  Record<string, string | number | boolean | null | undefined>
>;

export type ArticleCustomParameters = Readonly<Record<string, unknown>>;

export interface ArticleServiceContext {
  readonly articlesDirectory: string | null;
  readonly db: ArticleDatabase;
  readonly trashDirectory: string | null;
}

export interface CreateArticleInput {
  readonly customerFolderPath: string;
  readonly customParameters?: ArticleCustomParameters;
  readonly parameters: ArticleParameterValues;
}

export interface UpdateArticleInput {
  readonly customParameters?: ArticleCustomParameters;
  readonly folderPath: string;
  readonly parameters?: ArticleParameterValues;
}

export interface RemoveArticleInput {
  readonly folderPath: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isErrno(error: unknown, ...codes: readonly string[]): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const { code } = error as { code?: unknown };

  return typeof code === "string" && codes.includes(code);
}

/**
 * Maps the shared root-validation reason back to the article error codes the
 * IPC layer publishes. The message is preserved verbatim.
 */
function articleRootError(error: RootDirectoryError): ArticleServiceError {
  switch (error.reason) {
    case "NOT_CONFIGURED":
      return new ArticleServiceError("ROOT_NOT_CONFIGURED", error.message, {
        cause: error,
      });
    case "NOT_FOUND":
      return new ArticleServiceError("ROOT_NOT_FOUND", error.message, {
        cause: error,
      });
    case "SYMLINK":
      return new ArticleServiceError("ROOT_SYMLINK", error.message, {
        cause: error,
      });
    case "NOT_DIRECTORY":
      return new ArticleServiceError("ROOT_NOT_DIRECTORY", error.message, {
        cause: error,
      });
    default:
      return new ArticleServiceError("ROOT_NOT_FOUND", error.message, {
        cause: error,
      });
  }
}

async function assertArticlesRoot(
  context: ArticleServiceContext
): Promise<string> {
  try {
    return await assertConfiguredRoot(context.articlesDirectory);
  } catch (error) {
    if (!(error instanceof RootDirectoryError)) {
      throw error;
    }

    throw articleRootError(error);
  }
}

/**
 * Keeps the customers cache in step after an article folder is created or
 * removed. The row is owned by the customer scanner, so this refresh is best
 * effort: a failure here must never fail an article mutation that already
 * happened, and the next customer scan repairs the row. The customers UI reads
 * the cached `articleCount` to gate delete and key-change actions, so leaving
 * it stale would show the wrong affordances until a rescan.
 */
async function refreshCustomerArticleCount(
  context: ArticleServiceContext,
  customerFolderPath: string
): Promise<void> {
  try {
    const existing = getCustomerRow(context.db, customerFolderPath);

    if (existing === null) {
      return;
    }

    const rawMetadata = existing.metadataJson as unknown;

    if (
      typeof rawMetadata !== "object" ||
      rawMetadata === null ||
      Array.isArray(rawMetadata)
    ) {
      return;
    }

    const metadata = rawMetadata as CustomerCacheMetadata;
    const counted = await countValidArticles(
      customerFolderPath,
      existing.customerCode
    );
    const [folderStats, configStats] = await Promise.all([
      lstatIfExists(customerFolderPath),
      lstatIfExists(path.join(customerFolderPath, CUSTOMER_CONFIG_FILE_NAME)),
    ]);

    upsertCustomerRow(context.db, {
      articleSchemaVersion: existing.articleSchemaVersion,
      customerCode: existing.customerCode,
      folderMtimeMs: Math.floor(
        Math.max(folderStats?.mtimeMs ?? 0, configStats?.mtimeMs ?? 0)
      ),
      folderName: existing.folderName,
      folderPath: existing.folderPath,
      issues: Array.isArray(metadata.issues) ? [...metadata.issues] : [],
      metadata: { ...metadata, articleCount: counted.articleCount },
      name: existing.name,
      revisionSchemaVersion: existing.revisionSchemaVersion,
      schemaVersion: existing.schemaVersion,
      status: existing.status,
    });
  } catch {
    // Best effort: the authoritative customer scan will repair the cache.
  }
}

/**
 * Translates the generic trash failure into the article contract. Moving an
 * article into its own subdirectory and destination escapes are caller errors,
 * while filesystem move failures stay 5xx (`TRASH_MOVE_FAILED`).
 */
function articleTrashError(error: TrashMoveError): ArticleServiceError {
  switch (error.reason) {
    case "TRASH_NOT_FOUND":
    case "TRASH_SYMLINK":
    case "TRASH_NOT_DIRECTORY":
      return new ArticleServiceError(error.reason, error.message, {
        cause: error,
      });
    case "SOURCE_NOT_FOUND":
      return new ArticleServiceError("ARTICLE_NOT_FOUND", error.message, {
        cause: error,
      });
    case "SOURCE_SYMLINK":
      return new ArticleServiceError("ARTICLE_FOLDER_SYMLINK", error.message, {
        cause: error,
      });
    case "SOURCE_NOT_DIRECTORY":
      return new ArticleServiceError(
        "ARTICLE_FOLDER_NOT_DIRECTORY",
        error.message,
        { cause: error }
      );
    case "INVALID_FOLDER_NAME":
    case "SOURCE_NAME_MISMATCH":
      return new ArticleServiceError(
        "ARTICLE_FOLDER_NAME_INVALID",
        error.message,
        { cause: error }
      );
    case "TRASH_INSIDE_SOURCE":
    case "DESTINATION_OUTSIDE_TRASH":
    case "INVALID_SEGMENT":
    case "INVALID_PATH":
      return new ArticleServiceError("INVALID_OPERATION", error.message, {
        cause: error,
      });
    default:
      return new ArticleServiceError("TRASH_MOVE_FAILED", error.message, {
        cause: error,
      });
  }
}

/**
 * Re-verifies, immediately before a write, that the customer folder is still a
 * real direct child of the real root. `assertCustomerFolderDirectory` runs
 * earlier, so a folder swapped for a symlink in between would otherwise make
 * the write land outside the root.
 */
async function assertCustomerFolderStillConfined(
  root: string,
  customerFolderPath: string
): Promise<void> {
  const refusal = (cause?: unknown): ArticleServiceError =>
    new ArticleServiceError(
      "ARTICLE_CUSTOMER_SYMLINK",
      `Refusing to write into customer folder "${path.basename(customerFolderPath)}": it no longer resolves inside the articles directory.`,
      cause === undefined ? undefined : { cause }
    );
  let realRoot: string;
  let realCustomer: string;

  try {
    [realRoot, realCustomer] = await Promise.all([
      realpath(root),
      realpath(customerFolderPath),
    ]);
  } catch (error) {
    throw refusal(error);
  }

  const expected = path.join(realRoot, path.basename(customerFolderPath));

  if (realCustomer !== expected) {
    throw refusal();
  }
}

/**
 * Resolves a real path for a containment check. A path that cannot be resolved
 * refuses the operation instead of silently skipping the check.
 */
async function realpathOrRefuse(
  target: string,
  label: string,
  options: { readonly allowMissing?: boolean } = {}
): Promise<string | null> {
  try {
    return await realpath(target);
  } catch (error) {
    if (options.allowMissing && isErrno(error, "ENOENT")) {
      return null;
    }

    console.warn(`Unable to resolve the ${label} directory`, error);
    // biome-ignore lint/style/useErrorCause: the failure is logged above.
    throw new ArticleServiceError(
      "INVALID_OPERATION",
      `Unable to verify the ${label} directory location.`,
      { cause: error }
    );
  }
}

async function ensureArticleTrashSubdirectory(
  trashDirectory: string,
  customerFolderName: string
): Promise<string> {
  try {
    return await ensureTrashSubdirectory(
      trashDirectory,
      ARTICLE_TRASH_SEGMENT,
      customerFolderName
    );
  } catch (error) {
    if (error instanceof TrashMoveError) {
      throw articleTrashError(error);
    }

    throw error;
  }
}

async function moveArticleToTrash(input: {
  readonly folderName: string;
  readonly sourceFolderPath: string;
  readonly trashDirectory: string;
}): Promise<string> {
  try {
    return await moveFolderToTrash(input);
  } catch (error) {
    if (error instanceof TrashMoveError) {
      throw articleTrashError(error);
    }

    throw error;
  }
}

/**
 * Reads the customer definition that governs the article. A missing file and a
 * broken one are distinct: the former is repairable by creating the config, the
 * latter requires the customer to be fixed first.
 */
async function loadCustomerConfig(
  customerFolderPath: string
): Promise<CustomerConfig> {
  const configPath = path.join(customerFolderPath, CUSTOMER_CONFIG_FILE_NAME);
  let raw: unknown;

  try {
    raw = await readJsonFile(configPath, MAX_CUSTOMER_CONFIG_BYTES);
  } catch (error) {
    console.warn(`Unable to read "${configPath}"`, error);
    // biome-ignore lint/style/useErrorCause: the cause is forwarded by ArticleServiceError.
    throw new ArticleServiceError(
      "ARTICLE_CUSTOMER_CONFIG_INVALID",
      `Unable to read ${CUSTOMER_CONFIG_FILE_NAME}.`,
      { cause: error }
    );
  }

  if (raw === undefined) {
    throw new ArticleServiceError(
      "ARTICLE_CUSTOMER_CONFIG_MISSING",
      `${CUSTOMER_CONFIG_FILE_NAME} does not exist.`
    );
  }

  try {
    return parseCustomerConfig(raw);
  } catch (error) {
    console.warn(`Invalid customer config "${configPath}"`, error);
    // biome-ignore lint/style/useErrorCause: the cause is forwarded by ArticleServiceError.
    throw new ArticleServiceError(
      "ARTICLE_CUSTOMER_CONFIG_INVALID",
      `${CUSTOMER_CONFIG_FILE_NAME} is invalid.`,
      { cause: error }
    );
  }
}

function resolveArticleKey(
  config: CustomerConfig,
  values: ArticleParameterValues
): ResolvedKeyTemplate {
  try {
    return resolveKeyTemplate(
      config.article.key,
      config.article.parameters,
      values
    );
  } catch (error) {
    if (error instanceof CustomerServiceError) {
      // biome-ignore lint/style/useErrorCause: the cause is forwarded by ArticleServiceError.
      throw new ArticleServiceError("KEY_RENDER_INVALID", error.message, {
        cause: error,
      });
    }

    throw error;
  }
}

function invalidArticleData(message: string): ArticleServiceError {
  return new ArticleServiceError("ARTICLE_DATA_INVALID", message);
}

/**
 * Declared parameter values may only use the names declared by the customer
 * article section. An undeclared name would otherwise be silently discarded and
 * the declared default would be written instead.
 */
function assertDeclaredParameters(
  value: ArticleParameterValues,
  declared: ParameterDefinitions
): void {
  for (const name of Object.keys(value)) {
    if (!Object.hasOwn(declared, name)) {
      throw invalidArticleData(
        `Parameter "${name}" is not declared by the customer article parameters.`
      );
    }
  }
}

/**
 * Guards the write path: the document written by the app must still fit the
 * `article_data.json` size limit shared with readers and the scanner.
 */
function assertSerializedSize(config: ArticleConfig): void {
  const byteLength = Buffer.byteLength(serializeArticleConfig(config), "utf8");

  if (byteLength > MAX_ARTICLE_DATA_BYTES) {
    throw invalidArticleData(
      `article_data.json would be ${byteLength} bytes; the maximum is ${MAX_ARTICLE_DATA_BYTES}.`
    );
  }
}

/**
 * Removes a freshly created folder after a failed data write. The path is
 * re-inspected first: only a real directory (never a symlink or a file that
 * replaced it) may be removed.
 */
async function removeCreatedArticleFolder(folderPath: string): Promise<void> {
  let stats: Awaited<ReturnType<typeof lstatIfExists>>;

  try {
    stats = await lstatIfExists(folderPath);
  } catch {
    return;
  }

  if (!stats || stats.isSymbolicLink() || !stats.isDirectory()) {
    return;
  }

  await rm(folderPath, { force: true, recursive: true }).catch(() => undefined);
}

/**
 * Validates and narrows custom parameters. Reserved keys and names declared by
 * the customer are rejected instead of being silently reclassified by
 * `parseArticleConfig`; values follow the same scalar rules as Phase A.
 */
function normalizeCustomParameters(
  value: ArticleCustomParameters,
  declared: ParameterDefinitions
): Record<string, ArticleCustomValue> {
  const normalized: Record<string, ArticleCustomValue> = {};

  for (const [name, rawValue] of Object.entries(value)) {
    if (
      RESERVED_CUSTOM_PARAMETER_NAMES.has(name) ||
      Object.hasOwn(declared, name)
    ) {
      throw invalidArticleData(
        `Custom parameter "${name}" is reserved or already declared by the customer article parameters.`
      );
    }

    if (!PARAMETER_NAME_PATTERN.test(name)) {
      throw invalidArticleData(
        `Custom parameter name "${name}" must start with an uppercase letter and contain only uppercase letters, digits and underscores (1-64 characters).`
      );
    }

    if (typeof rawValue === "string") {
      if (rawValue.length > MAX_ARTICLE_CUSTOM_VALUE_LENGTH) {
        throw invalidArticleData(
          `Custom parameter "${name}" exceeds the maximum value length of ${MAX_ARTICLE_CUSTOM_VALUE_LENGTH} characters.`
        );
      }

      normalized[name] = rawValue;
      continue;
    }

    if (typeof rawValue === "boolean") {
      normalized[name] = rawValue;
      continue;
    }

    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      normalized[name] = rawValue;
      continue;
    }

    throw invalidArticleData(
      `Custom parameter "${name}" must be a string, a finite number or a boolean.`
    );
  }

  if (Object.keys(normalized).length > MAX_ARTICLE_CUSTOM_PARAMETERS) {
    throw invalidArticleData(
      `At most ${MAX_ARTICLE_CUSTOM_PARAMETERS} custom parameters are allowed.`
    );
  }

  return normalized;
}

function toArticleWriteError(error: unknown): ArticleServiceError {
  if (error instanceof ArticleServiceError) {
    return error;
  }

  return new ArticleServiceError("WRITE_FAILED", errorMessage(error), {
    cause: error,
  });
}

async function countArticleRevisions(
  articleFolderPath: string,
  config: CustomerConfig
): Promise<number> {
  try {
    return await countValidRevisions(articleFolderPath, config.revision);
  } catch (error) {
    if (error instanceof ArticleServiceError) {
      throw error;
    }

    console.warn(`Unable to count revisions in "${articleFolderPath}"`, error);
    // biome-ignore lint/style/useErrorCause: the cause is forwarded by ArticleServiceError.
    throw new ArticleServiceError(
      "ARTICLE_DATA_UNREADABLE",
      "Unable to count the article revisions.",
      { cause: error }
    );
  }
}

/**
 * Creates an article folder named after the rendered article key, writes the
 * canonical `article_data.json` atomically and caches the row with a revision
 * count of zero (the folder is new, so it has no revisions yet).
 */
export function createArticle(
  context: ArticleServiceContext,
  input: CreateArticleInput
): Promise<ArticleRecord> {
  return withCustomerLock(async () => {
    const root = await assertArticlesRoot(context);
    const customer = assertCustomerFolderPath(root, input.customerFolderPath);

    await assertCustomerFolderDirectory(customer.customerFolderPath);

    const config = await loadCustomerConfig(customer.customerFolderPath);

    assertDeclaredParameters(input.parameters, config.article.parameters);

    const resolved = resolveArticleKey(config, input.parameters);
    const folderName = assertSafeArticleFolderName(resolved.rendered);
    const folderPath = path.join(customer.customerFolderPath, folderName);

    if (await lstatIfExists(folderPath)) {
      throw new ArticleServiceError(
        "ARTICLE_ALREADY_EXISTS",
        `Article folder "${folderName}" already exists.`
      );
    }

    const customParameters = normalizeCustomParameters(
      input.customParameters ?? {},
      config.article.parameters
    );
    const rawDocument: Record<string, unknown> = {
      customer: Number(customer.customerCode),
      schemaVersion: ARTICLE_SCHEMA_VERSION,
      ...resolved.values,
      ...customParameters,
    };
    const articleConfig = parseArticleConfig(
      rawDocument,
      config.article,
      customer.customerCode
    );

    assertSerializedSize(articleConfig);

    await assertCustomerFolderStillConfined(root, customer.customerFolderPath);

    try {
      await mkdir(folderPath, { mode: 0o755 });
    } catch (error) {
      if (isErrno(error, "EEXIST")) {
        // biome-ignore lint/style/useErrorCause: the cause is forwarded by ArticleServiceError.
        throw new ArticleServiceError(
          "ARTICLE_ALREADY_EXISTS",
          `Article folder "${folderName}" already exists.`,
          { cause: error }
        );
      }

      // biome-ignore lint/style/useErrorCause: the cause is forwarded by ArticleServiceError.
      throw new ArticleServiceError(
        "WRITE_FAILED",
        `Unable to create article folder "${folderName}".`,
        { cause: error }
      );
    }

    try {
      await writeJsonAtomic(
        path.join(folderPath, ARTICLE_DATA_FILE_NAME),
        articleConfigDocument(articleConfig)
      );
    } catch (error) {
      // Never leave an empty article folder behind when the data write failed.
      // Re-inspect it first: only a real directory may be removed.
      await removeCreatedArticleFolder(folderPath);
      throw toArticleWriteError(error);
    }

    const row = upsertArticleRow(context.db, {
      activeRevision: articleConfig.activeRevision,
      customerCode: customer.customerCode,
      customerFolderPath: customer.customerFolderPath,
      folderMtimeMs: await articleFolderFingerprint(folderPath),
      folderName,
      folderPath,
      metadata: articleConfig,
      revisionCount: 0,
      schemaVersion: articleConfig.schemaVersion,
    });

    await refreshCustomerArticleCount(context, customer.customerFolderPath);

    return row;
  });
}

/**
 * Updates the article data. Parameters and custom parameters are merged over
 * the existing values, then the rendered key is compared with the current
 * folder name: the key is immutable once the article exists.
 */
export function updateArticle(
  context: ArticleServiceContext,
  input: UpdateArticleInput
): Promise<ArticleRecord> {
  return withCustomerLock(async () => {
    const root = await assertArticlesRoot(context);
    const article = assertArticleFolderPath(root, input.folderPath);

    await assertArticleFolderDirectory(article.articleFolderPath);
    await assertCustomerFolderDirectory(article.customerFolderPath);

    const config = await loadCustomerConfig(article.customerFolderPath);
    const dataPath = path.join(
      article.articleFolderPath,
      ARTICLE_DATA_FILE_NAME
    );
    const raw = await readArticleDataFile(dataPath);
    const existing = parseArticleConfig(
      raw,
      config.article,
      article.customerCode
    );

    const supplied: Record<
      string,
      string | number | boolean | null | undefined
    > = {
      ...existing.parameters,
      ...(input.parameters ?? {}),
    };

    if (input.parameters !== undefined) {
      assertDeclaredParameters(input.parameters, config.article.parameters);
    }

    const resolved = resolveArticleKey(config, supplied);

    // A custom-parameter-only update must keep working even when the folder was
    // renamed on disk; only an explicit parameter change re-checks the lock.
    if (
      input.parameters !== undefined &&
      resolved.rendered !== article.articleFolderName
    ) {
      throw new ArticleServiceError(
        "ARTICLE_KEY_LOCKED",
        `The article key cannot change: it renders "${resolved.rendered}" but the existing folder is "${article.articleFolderName}". Delete and recreate the article to change its identity.`
      );
    }

    const customParameters = normalizeCustomParameters(
      { ...existing.customParameters, ...(input.customParameters ?? {}) },
      config.article.parameters
    );
    const merged: ArticleConfig = {
      activeRevision: existing.activeRevision,
      customer: existing.customer,
      customParameters,
      parameters: { ...resolved.values },
      schemaVersion: existing.schemaVersion,
    };
    const validated = parseArticleConfig(
      articleConfigDocument(merged),
      config.article,
      article.customerCode
    );

    // Count before writing: an unreadable folder or an entry-budget failure
    // must abort the update without mutating the data file.
    const revisionCount = await countArticleRevisions(
      article.articleFolderPath,
      config
    );

    assertSerializedSize(validated);

    await assertCustomerFolderStillConfined(root, article.customerFolderPath);

    try {
      await writeJsonAtomic(dataPath, articleConfigDocument(validated));
    } catch (error) {
      throw toArticleWriteError(error);
    }

    return upsertArticleRow(context.db, {
      activeRevision: validated.activeRevision,
      customerCode: article.customerCode,
      customerFolderPath: article.customerFolderPath,
      folderMtimeMs: await articleFolderFingerprint(article.articleFolderPath),
      folderName: article.articleFolderName,
      folderPath: article.articleFolderPath,
      metadata: validated,
      revisionCount,
      schemaVersion: validated.schemaVersion,
    });
  });
}

/**
 * Moves the article folder to `<trash>/articles/<customer-folder>/<article>`
 * and deletes its cache row. The folder is never removed in place.
 */
export function removeArticle(
  context: ArticleServiceContext,
  input: RemoveArticleInput
): Promise<string> {
  return withCustomerLock(async () => {
    const root = await assertArticlesRoot(context);
    const article = assertArticleFolderPath(root, input.folderPath);

    await assertArticleFolderDirectory(article.articleFolderPath);
    await assertCustomerFolderDirectory(article.customerFolderPath);

    if (context.trashDirectory === null) {
      throw new ArticleServiceError(
        "TRASH_NOT_CONFIGURED",
        "The trash directory is not configured."
      );
    }

    // A trash inside the articles root would leave the moved article under the
    // root, where the next scan reports it as an unexpected entry. Compare real
    // paths so a symlinked intermediate component cannot smuggle it back.
    const trashDirectory = path.resolve(context.trashDirectory);
    const [realRoot, realTrash] = await Promise.all([
      realpathOrRefuse(root, "articles"),
      // A missing trash is reported as TRASH_NOT_FOUND by the next step.
      realpathOrRefuse(trashDirectory, "trash", { allowMissing: true }),
    ]);

    if (
      realRoot !== null &&
      realTrash !== null &&
      isPathInside(realRoot, realTrash)
    ) {
      throw new ArticleServiceError(
        "INVALID_OPERATION",
        "The trash directory must be outside the articles directory."
      );
    }

    const articleTrashDirectory = await ensureArticleTrashSubdirectory(
      trashDirectory,
      article.customerFolderName
    );

    // Guard against an ancestor trash directory: when the trash root is the
    // parent of the articles root and the root is named `articles`, the type
    // subdirectory resolves back inside the root and the move becomes an
    // in-place rename. Compare real paths after creation, before moving.
    const [realRootForTrash, realArticleTrashDirectory] = await Promise.all([
      realpathOrRefuse(root, "articles"),
      realpathOrRefuse(articleTrashDirectory, "article trash"),
    ]);

    if (
      realRootForTrash !== null &&
      realArticleTrashDirectory !== null &&
      isPathInside(realRootForTrash, realArticleTrashDirectory)
    ) {
      throw new ArticleServiceError(
        "INVALID_OPERATION",
        "The article trash subdirectory must be outside the articles directory."
      );
    }

    try {
      await moveArticleToTrash({
        folderName: article.articleFolderName,
        sourceFolderPath: article.articleFolderPath,
        trashDirectory: articleTrashDirectory,
      });
    } catch (error) {
      // The copy reached the trash but the source could not be removed: the
      // article is no longer authoritative here, so drop the stale cache row
      // and refresh the customer count before reporting the failure.
      if (
        error instanceof ArticleServiceError &&
        error.cause instanceof TrashMoveError &&
        error.cause.reason === "SOURCE_REMOVE_FAILED"
      ) {
        deleteArticleRow(context.db, article.articleFolderPath);
        await refreshCustomerArticleCount(context, article.customerFolderPath);
      }

      throw error;
    }

    // The folder was the source of truth; a missing cache row is not an error.
    deleteArticleRow(context.db, article.articleFolderPath);

    await refreshCustomerArticleCount(context, article.customerFolderPath);

    return article.articleFolderPath;
  });
}
