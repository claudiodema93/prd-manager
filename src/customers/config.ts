/**
 * Validation, parsing and serialisation of `customer_data.json`.
 *
 * The on-disk format is versioned: the current clean shape stores a
 * `schemaVersion` on the root and on each section. Legacy files may instead
 * duplicate the section versions as top-level `articleSchemaVersion` and
 * `revisionSchemaVersion` fields; those are accepted while reading but are
 * never written back.
 */

import { z } from "zod";
import { CustomerServiceError } from "./errors";
import { parseKeyTemplate } from "./key-template";
import type {
  CustomerConfig,
  CustomerSectionDefinition,
  ParameterDefinition,
  ParameterDefinitions,
} from "./types";
import { PARAMETER_TYPES } from "./types";

export const CUSTOMER_CONFIG_SCHEMA_VERSION = 1;
export const MAX_CUSTOMER_CONFIG_BYTES = 256 * 1024;

const MAX_CUSTOMER_NAME_LENGTH = 256;
const MAX_DEFAULT_LENGTH = 256;
const MAX_KEY_LENGTH = 512;
const MAX_PARAMETER_DEFINITIONS = 64;
const MIN_PARAMETER_DEFINITIONS = 1;

const PARAMETER_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;
const NUMBER_DEFAULT_PATTERN = /^\d+$/u;
const BOOL_DEFAULT_PATTERN = /^(?:true|false|1|0)$/iu;

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: RawRecord, key: string): boolean {
  return Object.hasOwn(value, key);
}

/**
 * Reads a value that is meant to be a schema version. Returns `null` when the
 * value is absent or not an integer, letting the structural schema report the
 * problem as `CONFIG_INVALID`.
 */
function readVersion(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  return null;
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function invalidConfig(message: string, cause?: unknown): CustomerServiceError {
  return new CustomerServiceError("CONFIG_INVALID", message, { cause });
}

function parseWithSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
  subject: string
): T {
  const result = schema.safeParse(value);

  if (result.success) {
    return result.data;
  }

  throw invalidConfig(
    `Invalid ${subject}: ${formatZodError(result.error)}`,
    result.error
  );
}

function findDefaultProblem(definition: ParameterDefinition): string | null {
  const { default: defaultValue, type } = definition;

  if (defaultValue === undefined) {
    return null;
  }

  if (type === "number") {
    return NUMBER_DEFAULT_PATTERN.test(defaultValue)
      ? null
      : `default must be a non-negative integer for a number parameter, received "${defaultValue}".`;
  }

  if (type === "bool") {
    return BOOL_DEFAULT_PATTERN.test(defaultValue)
      ? null
      : `default must be "true", "false", "1" or "0" for a bool parameter, received "${defaultValue}".`;
  }

  return null;
}

export const parameterDefinitionSchema: z.ZodType<ParameterDefinition> = z
  .object({
    default: z.string().max(MAX_DEFAULT_LENGTH).optional(),
    required: z.boolean(),
    type: z.enum(PARAMETER_TYPES),
  })
  .strict()
  .superRefine((definition, context) => {
    const problem = findDefaultProblem(definition);

    if (problem) {
      context.addIssue({ code: "custom", message: problem, path: ["default"] });
    }
  });

const parameterNameSchema = z
  .string()
  .regex(
    PARAMETER_NAME_PATTERN,
    "parameter names must start with an uppercase letter and contain only uppercase letters, digits and underscores (1-64 characters)."
  );

export const parameterDefinitionsSchema: z.ZodType<ParameterDefinitions> = z
  .record(parameterNameSchema, parameterDefinitionSchema)
  .superRefine((definitions, context) => {
    const count = Object.keys(definitions).length;

    if (count < MIN_PARAMETER_DEFINITIONS) {
      context.addIssue({
        code: "custom",
        message: `must define at least ${MIN_PARAMETER_DEFINITIONS} parameter.`,
      });
    }

    if (count > MAX_PARAMETER_DEFINITIONS) {
      context.addIssue({
        code: "custom",
        message: `must define at most ${MAX_PARAMETER_DEFINITIONS} parameters.`,
      });
    }
  });

function supportedSectionVersion(section: { schemaVersion: number }): boolean {
  return section.schemaVersion === CUSTOMER_CONFIG_SCHEMA_VERSION;
}

export const customerSectionDefinitionSchema: z.ZodType<CustomerSectionDefinition> =
  z
    .object({
      key: z.string().min(1).max(MAX_KEY_LENGTH),
      parameters: parameterDefinitionsSchema,
      schemaVersion: z.number().int(),
    })
    .strict()
    .refine(supportedSectionVersion, {
      message: `schemaVersion must be ${CUSTOMER_CONFIG_SCHEMA_VERSION}.`,
      path: ["schemaVersion"],
    });

const customerNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_CUSTOMER_NAME_LENGTH);

const legacySchemaVersionSchema = z.number().int().positive().optional();

export const customerConfigSchema: z.ZodType<CustomerConfig> = z
  .object({
    article: customerSectionDefinitionSchema,
    articleSchemaVersion: legacySchemaVersionSchema,
    customerName: customerNameSchema,
    revision: customerSectionDefinitionSchema,
    revisionSchemaVersion: legacySchemaVersionSchema,
    schemaVersion: z.number().int(),
  })
  .strict()
  .refine((config) => config.schemaVersion === CUSTOMER_CONFIG_SCHEMA_VERSION, {
    message: `schemaVersion must be ${CUSTOMER_CONFIG_SCHEMA_VERSION}.`,
    path: ["schemaVersion"],
  })
  .transform((config) => ({
    article: config.article,
    name: config.customerName,
    revision: config.revision,
    schemaVersion: config.schemaVersion,
  }));

/**
 * Resolves the effective version of a section, accepting the legacy top-level
 * duplicate. Throws when the two versions disagree or when the version is not
 * the supported one.
 */
function resolveSectionVersion(
  root: RawRecord,
  sectionName: "article" | "revision"
): void {
  const section = root[sectionName];

  if (!isRecord(section)) {
    return;
  }

  const legacyKey = `${sectionName}SchemaVersion`;
  const hasNestedVersion = hasOwn(section, "schemaVersion");
  const hasLegacyVersion = hasOwn(root, legacyKey);

  if (
    hasNestedVersion &&
    hasLegacyVersion &&
    section.schemaVersion !== root[legacyKey]
  ) {
    throw new CustomerServiceError(
      "CONFIG_VERSION_CONFLICT",
      `${sectionName}.schemaVersion (${String(
        section.schemaVersion
      )}) conflicts with the legacy top-level ${legacyKey} (${String(
        root[legacyKey]
      )}).`
    );
  }

  let effectiveVersion: unknown;

  if (hasNestedVersion) {
    effectiveVersion = section.schemaVersion;
  } else if (hasLegacyVersion) {
    effectiveVersion = root[legacyKey];
  } else {
    effectiveVersion = undefined;
  }

  const version = readVersion(effectiveVersion);

  if (version !== null && version !== CUSTOMER_CONFIG_SCHEMA_VERSION) {
    throw new CustomerServiceError(
      "CONFIG_UNSUPPORTED_VERSION",
      `${sectionName}.schemaVersion ${version} is not supported; expected ${CUSTOMER_CONFIG_SCHEMA_VERSION}.`
    );
  }
}

/**
 * Rejects an unsupported root version before structural validation so the
 * caller gets `CONFIG_UNSUPPORTED_VERSION` rather than a generic
 * `CONFIG_INVALID`.
 */
function assertRootVersionSupported(value: unknown): void {
  if (!isRecord(value)) {
    return;
  }

  const version = readVersion(value.schemaVersion);

  if (version !== null && version !== CUSTOMER_CONFIG_SCHEMA_VERSION) {
    throw new CustomerServiceError(
      "CONFIG_UNSUPPORTED_VERSION",
      `schemaVersion ${version} is not supported; expected ${CUSTOMER_CONFIG_SCHEMA_VERSION}.`
    );
  }
}

/**
 * Copies the legacy top-level section versions into the nested sections so the
 * clean schema can validate the value. Returns a shallow clone; the input is
 * never mutated.
 */
function normalizeLegacyVersions(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const normalized: RawRecord = { ...value };

  for (const sectionName of ["article", "revision"] as const) {
    const section = value[sectionName];

    if (!isRecord(section)) {
      continue;
    }

    const legacyKey = `${sectionName}SchemaVersion`;

    if (!hasOwn(section, "schemaVersion") && hasOwn(value, legacyKey)) {
      normalized[sectionName] = {
        ...section,
        schemaVersion: value[legacyKey],
      };
    }
  }

  return normalized;
}

function assertKeyTemplate(
  label: "article" | "revision" | "section",
  section: CustomerSectionDefinition
): void {
  try {
    parseKeyTemplate(section.key, section.parameters);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    throw invalidConfig(
      `Invalid ${label} key template "${section.key}": ${detail}`,
      error
    );
  }
}

export function parseCustomerConfig(value: unknown): CustomerConfig {
  assertRootVersionSupported(value);

  if (isRecord(value)) {
    resolveSectionVersion(value, "article");
    resolveSectionVersion(value, "revision");
  }

  const config = parseWithSchema(
    customerConfigSchema,
    normalizeLegacyVersions(value),
    "customer config"
  );

  assertKeyTemplate("article", config.article);
  assertKeyTemplate("revision", config.revision);

  return config;
}

export function parseCustomerConfigJson(text: string): CustomerConfig {
  const byteLength = Buffer.byteLength(text, "utf8");

  if (byteLength > MAX_CUSTOMER_CONFIG_BYTES) {
    throw invalidConfig(
      `customer_data.json is ${byteLength} bytes; the maximum is ${MAX_CUSTOMER_CONFIG_BYTES}.`
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    // CustomerServiceError forwards its options to `super`, so the cause is
    // retained even though Biome cannot trace it through the constructor.
    // biome-ignore lint/style/useErrorCause: the cause is forwarded by CustomerServiceError.
    throw new CustomerServiceError(
      "CONFIG_INVALID_JSON",
      `customer_data.json is not valid JSON: ${detail}`,
      { cause: error }
    );
  }

  return parseCustomerConfig(parsed);
}

export function parseCustomerSectionDefinition(
  value: unknown
): CustomerSectionDefinition {
  if (isRecord(value)) {
    const version = readVersion(value.schemaVersion);

    if (version !== null && version !== CUSTOMER_CONFIG_SCHEMA_VERSION) {
      throw new CustomerServiceError(
        "CONFIG_UNSUPPORTED_VERSION",
        `schemaVersion ${version} is not supported; expected ${CUSTOMER_CONFIG_SCHEMA_VERSION}.`
      );
    }
  }

  const section = parseWithSchema(
    customerSectionDefinitionSchema,
    value,
    "customer section definition"
  );

  assertKeyTemplate("section", section);

  return section;
}

export function serializeCustomerConfig(config: CustomerConfig): string {
  const parsed = parseCustomerConfig({
    article: config.article,
    customerName: config.name,
    revision: config.revision,
    schemaVersion: config.schemaVersion,
  });
  const document = {
    article: parsed.article,
    customerName: parsed.name,
    revision: parsed.revision,
    schemaVersion: parsed.schemaVersion,
  };

  return `${JSON.stringify(document, null, 2)}\n`;
}
