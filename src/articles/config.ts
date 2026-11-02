/**
 * Validation, parsing and serialisation of `article_data.json`.
 *
 * The clean shape written by the app is a flat JSON object:
 *
 * ```json
 * {
 *   "schemaVersion": 1,
 *   "customer": 1,
 *   "activeRevision": "REV_1",
 *   "CODE": "article-example-1",
 *   "CUSTOM_PARAM": "value"
 * }
 * ```
 *
 * Reserved keys (`schemaVersion`, `customer`, `activeRevision`) carry the
 * document metadata. Declared article parameters are canonicalised through the
 * customer key template; every other uppercase key is a custom parameter and is
 * preserved verbatim.
 */

import { MAX_ARTICLE_DATA_BYTES } from "../customers/folder";
import { resolveKeyTemplate } from "../customers/key-template";
import type {
  CustomerSectionDefinition,
  ParameterDefinitions,
} from "../customers/types";
import { ArticleServiceError } from "./errors";
import type { ArticleCacheMetadata, ArticleCustomValue } from "./types";

export const ARTICLE_SCHEMA_VERSION = 1;
export const MAX_ARTICLE_CUSTOM_VALUE_LENGTH = 1024;
export const MAX_ARTICLE_CUSTOM_PARAMETERS = 64;
export const MAX_ACTIVE_REVISION_LENGTH = 255;

const PARAMETER_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;
const NUMERIC_STRING_PATTERN = /^[+-]?\d+$/u;

const RESERVED_KEYS: ReadonlySet<string> = new Set([
  "activeRevision",
  "customer",
  "schemaVersion",
]);

type RawRecord = Record<string, unknown>;

/** The parsed, canonical form of `article_data.json`. */
export type ArticleConfig = ArticleCacheMetadata;

function isPlainObject(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string, cause?: unknown): ArticleServiceError {
  return new ArticleServiceError("ARTICLE_DATA_INVALID", message, { cause });
}

function invalidJson(message: string, cause: unknown): ArticleServiceError {
  return new ArticleServiceError("ARTICLE_DATA_INVALID_JSON", message, {
    cause,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isScalarParameterValue(
  value: unknown
): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

/**
 * Minimal validity rule for `article_data.json`: a plain object, a schema
 * version of at least one, and a `customer` value that resolves to the folder's
 * numeric customer code (so both `1` and `"0001"` match customer 0001). Extra
 * keys are allowed.
 */
export function isValidArticleData(
  value: unknown,
  customerCode: string
): value is RawRecord {
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

function parseCustomerNumber(value: unknown, customerCode: string): number {
  const expected = Number(customerCode);

  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value === expected
  ) {
    return value;
  }

  if (
    typeof value === "string" &&
    NUMERIC_STRING_PATTERN.test(value) &&
    Number(value) === expected
  ) {
    return expected;
  }

  throw invalid(
    `"customer" must equal the customer code ${customerCode} (a number or numeric string).`
  );
}

function parseSchemaVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw invalid(
      '"schemaVersion" must be an integer greater than or equal to 1.'
    );
  }

  return value;
}

function parseActiveRevision(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw invalid('"activeRevision" must be a string or null.');
  }

  if (
    value.length < 1 ||
    value.length > MAX_ACTIVE_REVISION_LENGTH ||
    value.includes("\0")
  ) {
    throw invalid(
      `"activeRevision" must contain between 1 and ${MAX_ACTIVE_REVISION_LENGTH} characters and no NUL.`
    );
  }

  if (
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.endsWith(" ") ||
    value.endsWith(".")
  ) {
    throw invalid(
      '"activeRevision" must be a single path component and must not end with a space or a dot.'
    );
  }

  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;

    if (code < 0x20 || code === 0x7f) {
      throw invalid(
        '"activeRevision" must not contain control characters or NUL.'
      );
    }
  }

  return value;
}

function parseDeclaredParameters(
  value: RawRecord,
  articleSection: CustomerSectionDefinition
): {
  readonly parameters: Record<string, string>;
  readonly rendered: string;
} {
  const supplied: Record<string, string | number | boolean | null | undefined> =
    {};

  for (const name of Object.keys(articleSection.parameters)) {
    if (!Object.hasOwn(value, name)) {
      continue;
    }

    const parameterValue = value[name];

    if (parameterValue === null || parameterValue === undefined) {
      supplied[name] = parameterValue;
      continue;
    }

    if (!isScalarParameterValue(parameterValue)) {
      throw invalid(
        `Declared parameter "${name}" must be a string, a finite number or a boolean.`
      );
    }

    supplied[name] = parameterValue;
  }

  try {
    const resolved = resolveKeyTemplate(
      articleSection.key,
      articleSection.parameters,
      supplied
    );

    return {
      parameters: { ...resolved.values },
      rendered: resolved.rendered,
    };
  } catch (error) {
    throw invalid(
      `Unable to resolve the article key: ${errorMessage(error)}`,
      error
    );
  }
}

function parseCustomParameters(
  value: RawRecord,
  articleSection: CustomerSectionDefinition
): Record<string, ArticleCustomValue> {
  const customParameters: Record<string, ArticleCustomValue> = {};
  const declared: ParameterDefinitions = articleSection.parameters;

  for (const [name, rawValue] of Object.entries(value)) {
    if (RESERVED_KEYS.has(name) || Object.hasOwn(declared, name)) {
      continue;
    }

    if (Object.keys(customParameters).length >= MAX_ARTICLE_CUSTOM_PARAMETERS) {
      throw invalid(
        `At most ${MAX_ARTICLE_CUSTOM_PARAMETERS} custom parameters are allowed.`
      );
    }

    if (!PARAMETER_NAME_PATTERN.test(name)) {
      throw invalid(
        `Custom parameter name "${name}" must start with an uppercase letter and contain only uppercase letters, digits and underscores (1-64 characters).`
      );
    }

    if (typeof rawValue === "string") {
      if (rawValue.length > MAX_ARTICLE_CUSTOM_VALUE_LENGTH) {
        throw invalid(
          `Custom parameter "${name}" exceeds the maximum value length of ${MAX_ARTICLE_CUSTOM_VALUE_LENGTH} characters.`
        );
      }

      customParameters[name] = rawValue;
      continue;
    }

    if (typeof rawValue === "boolean") {
      customParameters[name] = rawValue;
      continue;
    }

    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      customParameters[name] = rawValue;
      continue;
    }

    throw invalid(
      `Custom parameter "${name}" must be a string, a finite number or a boolean.`
    );
  }

  return customParameters;
}

/**
 * Parses and canonicalises an `article_data.json` value against the customer's
 * `article` section definition.
 */
export function parseArticleConfig(
  value: unknown,
  articleSection: CustomerSectionDefinition,
  customerCode: string
): ArticleConfig {
  if (!isPlainObject(value)) {
    throw invalid("article_data.json must contain a JSON object.");
  }

  const schemaVersion = parseSchemaVersion(value.schemaVersion);
  const customer = parseCustomerNumber(value.customer, customerCode);
  const activeRevision = parseActiveRevision(value.activeRevision);
  const declared = parseDeclaredParameters(value, articleSection);
  const customParameters = parseCustomParameters(value, articleSection);

  return {
    activeRevision,
    customer,
    customParameters,
    parameters: declared.parameters,
    schemaVersion,
  };
}

export function parseArticleConfigJson(
  text: string,
  articleSection: CustomerSectionDefinition,
  customerCode: string
): ArticleConfig {
  const byteLength = Buffer.byteLength(text, "utf8");

  if (byteLength > MAX_ARTICLE_DATA_BYTES) {
    throw invalid(
      `article_data.json is ${byteLength} bytes; the maximum is ${MAX_ARTICLE_DATA_BYTES}.`
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw invalidJson(
      `article_data.json is not valid JSON: ${errorMessage(error)}`,
      error
    );
  }

  return parseArticleConfig(parsed, articleSection, customerCode);
}

/**
 * Builds the clean on-disk document. `activeRevision` is omitted when there is
 * none, so a file without an active revision does not gain a `null` key on
 * every update.
 */
export function articleConfigDocument(
  config: ArticleConfig
): Record<string, unknown> {
  const document: Record<string, unknown> = {
    customer: config.customer,
    schemaVersion: config.schemaVersion,
  };

  if (config.activeRevision !== null) {
    document.activeRevision = config.activeRevision;
  }

  for (const [name, value] of Object.entries(config.parameters)) {
    document[name] = value;
  }

  for (const [name, value] of Object.entries(config.customParameters)) {
    document[name] = value;
  }

  return document;
}

export function serializeArticleConfig(config: ArticleConfig): string {
  return `${JSON.stringify(articleConfigDocument(config), null, 2)}\n`;
}
