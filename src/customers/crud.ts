/**
 * Filesystem-first CRUD for customers.
 *
 * `customer_data.json` and the customer folder are the source of truth; the
 * SQLite table is only a cache. Every exported operation therefore validates
 * the filesystem state, performs the filesystem change, and only then updates
 * the cache row. The operations are serialised through `withCustomerLock` so a
 * concurrent scan cannot observe a half-written folder, and they intentionally
 * never call `scanCustomers` themselves (the lock is not re-entrant).
 */

import type { Dirent } from "node:fs";
import { mkdir, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import {
  CUSTOMER_CONFIG_SCHEMA_VERSION,
  MAX_CUSTOMER_CONFIG_BYTES,
  parseCustomerConfig,
  parseCustomerSectionDefinition,
  serializeCustomerConfig,
} from "./config";
import { CustomerServiceError } from "./errors";
import {
  CUSTOMER_CODE_PATTERN,
  CUSTOMER_FOLDER_PATTERN,
  type CustomerFolderName,
  countValidArticles,
  customerFolderNameForCode,
  isPathInside,
  lstatIfExists,
  moveCustomerToTrash,
  parseCustomerFolderName,
  readJsonFile,
  writeJsonAtomic,
} from "./folder";
import { withCustomerLock } from "./lock";
import {
  type CustomerDatabase,
  type CustomerRecord,
  deleteCustomerRow,
  type UpsertCustomerRowInput,
  upsertCustomerRow,
} from "./store";
import type {
  CustomerConfig,
  CustomerIssue,
  CustomerSectionDefinition,
} from "./types";

const CUSTOMER_CONFIG_FILE_NAME = "customer_data.json";

const MAX_CUSTOMER_NAME_LENGTH = 256;
const FIRST_CUSTOMER_CODE = 1;
const LAST_CUSTOMER_CODE = 9999;

/**
 * Config errors that only mean "there is no usable config yet". A version the
 * app does not support (for example one written by a newer release) is
 * repairable too, but only while the customer has no articles: otherwise the
 * key lock must be enforced against the authoritative file.
 */
const MISSING_CONFIG_ERROR_CODES: ReadonlySet<string> = new Set([
  "CONFIG_INVALID",
  "CONFIG_INVALID_JSON",
  "CONFIG_MISSING",
  "CONFIG_UNREADABLE",
  "CONFIG_UNSUPPORTED_VERSION",
  "CONFIG_VERSION_CONFLICT",
]);

export interface CustomerServiceContext {
  readonly articlesDirectory: string | null;
  readonly db: CustomerDatabase;
  readonly trashDirectory: string | null;
}

export interface CreateCustomerInput {
  readonly article: CustomerSectionDefinition;
  readonly customerCode?: string;
  readonly name: string;
  readonly revision: CustomerSectionDefinition;
}

export interface UpdateCustomerInput {
  readonly article?: CustomerSectionDefinition;
  readonly folderPath: string;
  readonly name?: string;
  readonly revision?: CustomerSectionDefinition;
}

export interface RemoveCustomerInput {
  readonly folderPath: string;
}

interface RowInputSource {
  readonly articleCount: number;
  readonly config: CustomerConfig;
  readonly customerCode: string;
  readonly folderMtimeMs: number;
  readonly folderName: string;
  readonly folderPath: string;
  readonly issues: readonly CustomerIssue[];
}

function configPathFor(folderPath: string): string {
  return path.join(folderPath, CUSTOMER_CONFIG_FILE_NAME);
}

/**
 * Resolves and validates the configured articles directory. A broken root is
 * reported explicitly rather than being treated as "no customers".
 */
async function assertArticlesDirectory(
  context: CustomerServiceContext
): Promise<string> {
  if (context.articlesDirectory === null) {
    throw new CustomerServiceError(
      "ROOT_NOT_CONFIGURED",
      "The articles directory is not configured."
    );
  }

  const root = path.resolve(context.articlesDirectory);
  const stats = await lstatIfExists(root);

  if (!stats) {
    throw new CustomerServiceError(
      "ROOT_NOT_FOUND",
      `Articles directory "${root}" does not exist.`
    );
  }

  if (stats.isSymbolicLink()) {
    throw new CustomerServiceError(
      "ROOT_SYMLINK",
      `Refusing to use articles directory "${root}": it is a symbolic link.`
    );
  }

  if (!stats.isDirectory()) {
    throw new CustomerServiceError(
      "ROOT_NOT_DIRECTORY",
      `Articles directory "${root}" is not a directory.`
    );
  }

  return root;
}

/**
 * Confines a caller-supplied folder path to the configured root. The root
 * itself is not a customer folder, so it is rejected too.
 */
function assertCustomerPath(root: string, folderPath: string): string {
  if (folderPath.includes("\0")) {
    throw new CustomerServiceError(
      "INVALID_OPERATION",
      `Customer folder path contains a NUL character: "${folderPath}".`
    );
  }

  const resolved = path.resolve(folderPath);
  const parent = path.dirname(resolved);
  const isDirectChild =
    process.platform === "win32"
      ? parent.toLowerCase() === root.toLowerCase()
      : parent === root;

  // Customer folders are always direct children of the root. Checking the
  // parent (not only the lexical prefix) also rejects a path that reaches the
  // root through a symlinked intermediate directory.
  if (resolved === root || !isDirectChild) {
    throw new CustomerServiceError(
      "INVALID_OPERATION",
      `Customer folder "${resolved}" must be a direct child of the articles directory "${root}".`
    );
  }

  return resolved;
}

function validateName(name: string): string {
  const trimmed = name.trim();

  if (trimmed.length < 1 || trimmed.length > MAX_CUSTOMER_NAME_LENGTH) {
    throw new CustomerServiceError(
      "CUSTOMER_NAME_INVALID",
      `Customer name must contain between 1 and ${MAX_CUSTOMER_NAME_LENGTH} characters after trimming.`
    );
  }

  return trimmed;
}

/**
 * Reads the current config, treating a missing or unreadable/invalid file as
 * "no usable config". Callers decide whether that is fatal.
 */
async function readExistingConfig(
  folderPath: string
): Promise<CustomerConfig | null> {
  const configPath = configPathFor(folderPath);

  try {
    const raw = await readJsonFile(configPath, MAX_CUSTOMER_CONFIG_BYTES);

    if (raw === undefined) {
      return null;
    }

    return parseCustomerConfig(raw);
  } catch (error) {
    if (
      error instanceof CustomerServiceError &&
      (error.code === "READ_FAILED" ||
        MISSING_CONFIG_ERROR_CODES.has(error.code))
    ) {
      return null;
    }

    throw error;
  }
}

/**
 * Re-reads the config without swallowing errors, so the real `CONFIG_*` code
 * reaches the caller. Used when articles exist and the key lock must be
 * enforced against the authoritative file.
 */
async function readRequiredConfig(folderPath: string): Promise<CustomerConfig> {
  const configPath = configPathFor(folderPath);

  let raw: unknown;

  try {
    raw = await readJsonFile(configPath, MAX_CUSTOMER_CONFIG_BYTES);
  } catch (error) {
    if (error instanceof CustomerServiceError && error.code === "READ_FAILED") {
      // biome-ignore lint/style/useErrorCause: the cause is forwarded by CustomerServiceError.
      throw new CustomerServiceError(
        "CONFIG_UNREADABLE",
        `Unable to read "${configPath}".`,
        { cause: error }
      );
    }

    throw error;
  }

  if (raw === undefined) {
    throw new CustomerServiceError(
      "CONFIG_MISSING",
      `"${configPath}" does not exist.`
    );
  }

  return parseCustomerConfig(raw);
}

/**
 * Cheap change detector for the scanner: the newest mtime of the folder and
 * its config file, floored to whole milliseconds (0 when both are missing).
 */
async function fingerprint(
  folderPath: string,
  configPath: string
): Promise<number> {
  const [folderStats, configStats] = await Promise.all([
    lstatIfExists(folderPath).catch(() => undefined),
    lstatIfExists(configPath).catch(() => undefined),
  ]);
  const newest = Math.max(folderStats?.mtimeMs ?? 0, configStats?.mtimeMs ?? 0);

  return Math.floor(newest);
}

async function assertCustomerFolder(folderPath: string): Promise<void> {
  const stats = await lstatIfExists(folderPath);

  if (!stats) {
    throw new CustomerServiceError(
      "CUSTOMER_NOT_FOUND",
      `Customer folder "${folderPath}" does not exist.`
    );
  }

  if (stats.isSymbolicLink()) {
    throw new CustomerServiceError(
      "CUSTOMER_FOLDER_SYMLINK",
      `Refusing to use customer folder "${folderPath}": it is a symbolic link.`
    );
  }

  if (!stats.isDirectory()) {
    throw new CustomerServiceError(
      "CUSTOMER_FOLDER_NOT_DIRECTORY",
      `Customer folder "${folderPath}" is not a directory.`
    );
  }
}

/**
 * Builds the cache row from an already-validated config plus the article scan
 * result. `searchText` is derived by the store.
 */
function resolveStatus(
  issues: readonly CustomerIssue[]
): "error" | "ok" | "warning" {
  if (issues.some((issue) => issue.severity === "error")) {
    return "error";
  }

  return issues.length > 0 ? "warning" : "ok";
}

function rowInput(source: RowInputSource): UpsertCustomerRowInput {
  const { config } = source;

  return {
    articleSchemaVersion: config.article.schemaVersion,
    customerCode: source.customerCode,
    folderMtimeMs: source.folderMtimeMs,
    folderName: source.folderName,
    folderPath: source.folderPath,
    issues: source.issues,
    metadata: {
      article: config.article,
      articleCount: source.articleCount,
      issues: [...source.issues],
      revision: config.revision,
    },
    name: config.name,
    revisionSchemaVersion: config.revision.schemaVersion,
    schemaVersion: config.schemaVersion,
    status: resolveStatus(source.issues),
  };
}

async function nextFreeCustomerCode(root: string): Promise<string> {
  let entries: Dirent[];

  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    // biome-ignore lint/style/useErrorCause: the cause is forwarded by CustomerServiceError.
    throw new CustomerServiceError(
      "READ_FAILED",
      `Unable to read the articles directory "${root}".`,
      { cause: error }
    );
  }

  const taken = new Set<string>();

  for (const entry of entries) {
    const match = CUSTOMER_FOLDER_PATTERN.exec(entry.name);

    if (match?.[1]) {
      taken.add(match[1]);
    }
  }

  for (
    let value = FIRST_CUSTOMER_CODE;
    value <= LAST_CUSTOMER_CODE;
    value += 1
  ) {
    const code = String(value).padStart(4, "0");

    if (!taken.has(code)) {
      return code;
    }
  }

  throw new CustomerServiceError(
    "CUSTOMER_CODE_EXHAUSTED",
    `No free customer code remains between 0001 and 9999 in "${root}".`
  );
}

function validateRequestedCode(requested: string): string {
  if (!CUSTOMER_CODE_PATTERN.test(requested) || requested === "0000") {
    throw new CustomerServiceError(
      "CUSTOMER_CODE_INVALID",
      `Customer code must be four digits between 0001 and 9999 (received "${requested}").`
    );
  }

  return requested;
}

/**
 * Serialises the config through the owning module so validation and the
 * on-disk shape (`customerName`, not `name`) stay in one place, then hands the
 * parsed document to `writeJsonAtomic`.
 */
function configDocument(config: CustomerConfig): unknown {
  const serialized = serializeCustomerConfig(config);

  return JSON.parse(serialized) as unknown;
}

async function locateCustomer(
  context: CustomerServiceContext,
  folderPathInput: string
): Promise<{
  folderPath: string;
  parsed: CustomerFolderName;
  root: string;
}> {
  const root = await assertArticlesDirectory(context);
  const folderPath = assertCustomerPath(root, folderPathInput);

  await assertCustomerFolder(folderPath);

  const parsed = parseCustomerFolderName(path.basename(folderPath));

  if (!parsed) {
    throw new CustomerServiceError(
      "CUSTOMER_FOLDER_NAME_INVALID",
      `"${path.basename(folderPath)}" is not a valid customer folder name.`
    );
  }

  return { folderPath, parsed, root };
}

/**
 * Returns the config to build the update on. A missing or broken config is
 * only repairable when there are no articles and the caller supplied every
 * field; otherwise the real read error or `INVALID_OPERATION` propagates.
 */
async function resolveCurrentConfig(
  folderPath: string,
  articleCount: number,
  input: UpdateCustomerInput
): Promise<CustomerConfig | null> {
  const current = await readExistingConfig(folderPath);

  if (current !== null) {
    return current;
  }

  if (articleCount > 0) {
    return readRequiredConfig(folderPath);
  }

  if (
    input.name === undefined ||
    input.article === undefined ||
    input.revision === undefined
  ) {
    throw new CustomerServiceError(
      "INVALID_OPERATION",
      `"${CUSTOMER_CONFIG_FILE_NAME}" is missing or invalid; name, article and revision are required to repair it.`
    );
  }

  return null;
}

function buildUpdatedConfig(
  current: CustomerConfig | null,
  input: UpdateCustomerInput
): CustomerConfig {
  const name =
    input.name === undefined ? current?.name : validateName(input.name);
  const article =
    input.article === undefined
      ? current?.article
      : parseCustomerSectionDefinition(input.article);
  const revision =
    input.revision === undefined
      ? current?.revision
      : parseCustomerSectionDefinition(input.revision);

  if (name === undefined || article === undefined || revision === undefined) {
    throw new CustomerServiceError(
      "INVALID_OPERATION",
      "The customer config is incomplete and cannot be updated."
    );
  }

  return {
    article,
    name,
    revision,
    schemaVersion: CUSTOMER_CONFIG_SCHEMA_VERSION,
  };
}

/**
 * Keys are immutable once a customer has articles because every article folder
 * was derived from them. Other parameters remain editable.
 */
function assertKeysUnlocked(
  current: CustomerConfig | null,
  articleCount: number,
  config: CustomerConfig
): void {
  if (articleCount === 0) {
    return;
  }

  if (current === null) {
    throw new CustomerServiceError(
      "INVALID_OPERATION",
      "The customer config disappeared while the customer had articles."
    );
  }

  if (config.article.key !== current.article.key) {
    throw new CustomerServiceError(
      "KEY_LOCKED",
      "The article key cannot change while the customer has articles."
    );
  }

  if (config.revision.key !== current.revision.key) {
    throw new CustomerServiceError(
      "KEY_LOCKED",
      "The revision key cannot change while the customer has articles."
    );
  }
}

async function resolveConfigForUpdate(
  folderPath: string,
  articleCount: number,
  input: UpdateCustomerInput
): Promise<CustomerConfig> {
  const current = await resolveCurrentConfig(folderPath, articleCount, input);
  const config = buildUpdatedConfig(current, input);

  assertKeysUnlocked(current, articleCount, config);

  return config;
}

export function createCustomer(
  context: CustomerServiceContext,
  input: CreateCustomerInput
): Promise<CustomerRecord> {
  return withCustomerLock(async () => {
    const root = await assertArticlesDirectory(context);
    const name = validateName(input.name);
    const article = parseCustomerSectionDefinition(input.article);
    const revision = parseCustomerSectionDefinition(input.revision);
    const customerCode =
      input.customerCode === undefined
        ? await nextFreeCustomerCode(root)
        : validateRequestedCode(input.customerCode);
    const folderName = customerFolderNameForCode(customerCode);
    const folderPath = assertCustomerPath(root, path.join(root, folderName));

    if (await lstatIfExists(folderPath)) {
      throw new CustomerServiceError(
        "CUSTOMER_CODE_TAKEN",
        `Customer code ${customerCode} is already used by "${folderName}".`
      );
    }

    const config: CustomerConfig = {
      article,
      name,
      revision,
      schemaVersion: CUSTOMER_CONFIG_SCHEMA_VERSION,
    };
    const document = configDocument(config);
    const configPath = configPathFor(folderPath);

    try {
      await mkdir(folderPath, { mode: 0o755 });
    } catch (error) {
      // biome-ignore lint/style/useErrorCause: the cause is forwarded by CustomerServiceError.
      throw new CustomerServiceError(
        "WRITE_FAILED",
        `Unable to create customer folder "${folderPath}".`,
        { cause: error }
      );
    }

    try {
      await writeJsonAtomic(configPath, document);
    } catch (error) {
      await rm(folderPath, { force: true, recursive: true }).catch(
        () => undefined
      );
      throw error;
    }

    return upsertCustomerRow(
      context.db,
      rowInput({
        articleCount: 0,
        config,
        customerCode,
        folderMtimeMs: await fingerprint(folderPath, configPath),
        folderName,
        folderPath,
        issues: [],
      })
    );
  });
}

export function updateCustomer(
  context: CustomerServiceContext,
  input: UpdateCustomerInput
): Promise<CustomerRecord> {
  return withCustomerLock(async () => {
    const { folderPath, parsed } = await locateCustomer(
      context,
      input.folderPath
    );
    const counted = await countValidArticles(folderPath, parsed.customerCode);
    const config = await resolveConfigForUpdate(
      folderPath,
      counted.articleCount,
      input
    );
    const configPath = configPathFor(folderPath);

    await writeJsonAtomic(configPath, configDocument(config));

    return upsertCustomerRow(
      context.db,
      rowInput({
        articleCount: counted.articleCount,
        config,
        customerCode: parsed.customerCode,
        folderMtimeMs: await fingerprint(folderPath, configPath),
        folderName: parsed.folderName,
        folderPath,
        issues: counted.issues,
      })
    );
  });
}

export function removeCustomer(
  context: CustomerServiceContext,
  input: RemoveCustomerInput
): Promise<string> {
  return withCustomerLock(async () => {
    const { folderPath, parsed, root } = await locateCustomer(
      context,
      input.folderPath
    );
    const counted = await countValidArticles(folderPath, parsed.customerCode);

    if (counted.articleCount > 0) {
      throw new CustomerServiceError(
        "CUSTOMER_HAS_ARTICLES",
        `Customer "${parsed.folderName}" contains ${counted.articleCount} valid article(s) and cannot be removed.`
      );
    }

    if (context.trashDirectory === null) {
      throw new CustomerServiceError(
        "TRASH_NOT_CONFIGURED",
        "The trash directory is not configured."
      );
    }

    // A trash inside the articles root would leave the deleted customer folder
    // under the root, where the next scan reports it as an unexpected entry.
    // Compare real paths: a symlinked intermediate component must not smuggle
    // the trash back underneath the root.
    const trashDirectory = path.resolve(context.trashDirectory);
    const [realRoot, realTrash] = await Promise.all([
      realpath(root).catch(() => null),
      realpath(trashDirectory).catch(() => null),
    ]);

    if (
      realRoot !== null &&
      realTrash !== null &&
      isPathInside(realRoot, realTrash)
    ) {
      throw new CustomerServiceError(
        "INVALID_OPERATION",
        "The trash directory must be outside the articles directory."
      );
    }

    await moveCustomerToTrash({
      folderName: parsed.folderName,
      sourceFolderPath: folderPath,
      trashDirectory,
    });

    // The folder was the source of truth; a missing cache row is not an error.
    deleteCustomerRow(context.db, folderPath);

    return folderPath;
  });
}
