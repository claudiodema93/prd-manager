/**
 * Parser and renderer for the `key` template used by the `article` and
 * `revision` sections of `customer_data.json`.
 *
 * Template syntax:
 * - `{NAME}` inserts the value of a parameter.
 * - `{NAME:00}` inserts a numeric parameter zero-padded to the given width.
 * - `[...]` is an optional group, omitted when every parameter inside it is
 *   "insignificant" (empty text, number `0`, boolean `false`).
 *
 * This module has no Electron or filesystem dependency so it can be unit
 * tested in isolation.
 */

import { CustomerServiceError } from "./errors";
import type {
  ParameterDefinition,
  ParameterDefinitions,
  ParameterType,
} from "./types";

const MAX_TEMPLATE_LENGTH = 512;
const MAX_TEXT_LENGTH = 256;
const MAX_KEY_BYTES = 255;
const PLACEHOLDER_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;
const ZERO_PADDING_PATTERN = /^0+$/u;
const DIGITS_PATTERN = /^\d+$/u;
const LEADING_ZEROS_PATTERN = /^0+(?=\d)/u;
const WINDOWS_RESERVED_NAME_PATTERN =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

const FORBIDDEN_LITERAL_CHARACTERS: ReadonlySet<string> = new Set([
  "/",
  "\\",
  "\u0000",
  ":",
  "*",
  "?",
  '"',
  "<",
  ">",
  "|",
]);

const PATH_SEPARATOR_CHARACTERS: ReadonlySet<string> = new Set(["/", "\\"]);

const RESERVED_KEY_CHARACTERS: ReadonlySet<string> = new Set([
  ":",
  "*",
  "?",
  '"',
  "<",
  ">",
  "|",
]);

export interface ParsedKeyTemplate {
  readonly hasPlaceholders: boolean;
  readonly referencedParameters: readonly string[];
  readonly source: string;
  readonly tokens: readonly TemplateToken[];
}

export type TemplateToken =
  | { readonly kind: "literal"; readonly value: string }
  | {
      readonly kind: "placeholder";
      readonly name: string;
      readonly width: number | null;
    }
  | { readonly kind: "optional"; readonly tokens: readonly TemplateToken[] };

interface PlaceholderToken {
  readonly kind: "placeholder";
  readonly name: string;
  readonly width: number | null;
}

interface OptionalToken {
  readonly kind: "optional";
  readonly tokens: readonly TemplateToken[];
}

interface PlaceholderParseResult {
  readonly nextIndex: number;
  readonly token: PlaceholderToken;
}

interface OptionalParseResult {
  readonly hasPlaceholder: boolean;
  readonly nextIndex: number;
  readonly token: OptionalToken;
}

interface SequenceParseResult {
  readonly hasPlaceholder: boolean;
  readonly nextIndex: number;
  readonly tokens: TemplateToken[];
}

interface ResolvedParameterValue {
  readonly significant: boolean;
  readonly value: string;
}

interface RenderedSequence {
  readonly significant: boolean;
  readonly text: string;
}

function templateError(message: string): CustomerServiceError {
  return new CustomerServiceError("KEY_TEMPLATE_INVALID", message);
}

function renderError(message: string): CustomerServiceError {
  return new CustomerServiceError("KEY_RENDER_INVALID", message);
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;

    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }

  return false;
}

function containsCharacter(
  value: string,
  characters: ReadonlySet<string>
): boolean {
  for (const character of value) {
    if (characters.has(character)) {
      return true;
    }
  }

  return false;
}

function assertLiteralCharacter(character: string, index: number): void {
  const code = character.codePointAt(0) ?? 0;

  if (code < 0x20 || code === 0x7f) {
    throw templateError(
      `Control characters are not allowed in a key template (position ${index}).`
    );
  }

  if (FORBIDDEN_LITERAL_CHARACTERS.has(character)) {
    throw templateError(
      `Character "${character}" is not allowed in a key template (position ${index}).`
    );
  }
}

function parsePlaceholder(
  template: string,
  parameters: ParameterDefinitions,
  start: number
): PlaceholderParseResult {
  const closing = template.indexOf("}", start + 1);

  if (closing === -1) {
    throw templateError(
      `Unterminated placeholder starting at position ${start}.`
    );
  }

  const body = template.slice(start + 1, closing);
  const separator = body.indexOf(":");
  const name = separator === -1 ? body : body.slice(0, separator);
  const format = separator === -1 ? null : body.slice(separator + 1);

  if (!PLACEHOLDER_NAME_PATTERN.test(name)) {
    throw templateError(
      `Invalid placeholder name "${name}" at position ${start}.`
    );
  }

  if (!Object.hasOwn(parameters, name)) {
    throw templateError(
      `Placeholder "${name}" at position ${start} is not declared in the parameters.`
    );
  }

  const definition = parameters[name];
  let width: number | null = null;

  if (format !== null) {
    if (!ZERO_PADDING_PATTERN.test(format)) {
      throw templateError(
        `Invalid format ":${format}" at position ${start}; only zero padding such as ":00" is supported.`
      );
    }

    if (definition.type !== "number") {
      throw templateError(
        `Placeholder "${name}" at position ${start} uses zero padding but refers to a ${definition.type} parameter.`
      );
    }

    width = format.length;
  }

  return {
    nextIndex: closing + 1,
    token: { kind: "placeholder", name, width },
  };
}

function parseSequence(
  template: string,
  parameters: ParameterDefinitions,
  start: number,
  terminator: "]" | null
): SequenceParseResult {
  let index = start;
  let literal = "";
  let hasPlaceholder = false;
  const tokens: TemplateToken[] = [];

  const flushLiteral = (): void => {
    if (literal.length > 0) {
      tokens.push({ kind: "literal", value: literal });
      literal = "";
    }
  };

  while (index < template.length) {
    const character = template.charAt(index);

    if (terminator !== null && character === "]") {
      flushLiteral();
      return { hasPlaceholder, nextIndex: index + 1, tokens };
    }

    if (character === "[") {
      if (terminator !== null) {
        throw templateError(
          `Nested optional groups are not allowed (position ${index}).`
        );
      }

      flushLiteral();
      const group = parseOptionalGroup(template, parameters, index);
      tokens.push(group.token);

      if (group.hasPlaceholder) {
        hasPlaceholder = true;
      }

      index = group.nextIndex;
      continue;
    }

    if (character === "]") {
      throw templateError(`Unexpected "]" at position ${index}.`);
    }

    if (character === "{") {
      flushLiteral();
      const placeholder = parsePlaceholder(template, parameters, index);
      tokens.push(placeholder.token);
      hasPlaceholder = true;
      index = placeholder.nextIndex;
      continue;
    }

    if (character === "}") {
      throw templateError(`Unexpected "}" at position ${index}.`);
    }

    assertLiteralCharacter(character, index);
    literal += character;
    index += 1;
  }

  if (terminator !== null) {
    throw templateError(
      `Unterminated optional group starting at position ${start - 1}.`
    );
  }

  flushLiteral();

  return { hasPlaceholder, nextIndex: index, tokens };
}

function parseOptionalGroup(
  template: string,
  parameters: ParameterDefinitions,
  start: number
): OptionalParseResult {
  const content = parseSequence(template, parameters, start + 1, "]");

  if (content.tokens.length === 0) {
    throw templateError(`Optional group at position ${start} is empty.`);
  }

  if (!content.hasPlaceholder) {
    throw templateError(
      `Optional group at position ${start} must contain at least one placeholder.`
    );
  }

  return {
    hasPlaceholder: true,
    nextIndex: content.nextIndex,
    token: { kind: "optional", tokens: content.tokens },
  };
}

function collectReferencedParameters(
  tokens: readonly TemplateToken[],
  referenced: string[],
  seen: Set<string>
): void {
  for (const token of tokens) {
    if (token.kind === "placeholder") {
      if (!seen.has(token.name)) {
        seen.add(token.name);
        referenced.push(token.name);
      }

      continue;
    }

    if (token.kind === "optional") {
      collectReferencedParameters(token.tokens, referenced, seen);
    }
  }
}

/**
 * Parses and validates a key template. Every placeholder must reference a
 * declared parameter; the template must contain at least one placeholder.
 */
export function parseKeyTemplate(
  template: string,
  parameters: ParameterDefinitions
): ParsedKeyTemplate {
  if (template.length < 1 || template.length > MAX_TEMPLATE_LENGTH) {
    throw templateError(
      `A key template must contain between 1 and ${MAX_TEMPLATE_LENGTH} characters.`
    );
  }

  const parsed = parseSequence(template, parameters, 0, null);

  if (!parsed.hasPlaceholder) {
    throw templateError(
      "A key template must contain at least one placeholder."
    );
  }

  const referenced: string[] = [];
  collectReferencedParameters(parsed.tokens, referenced, new Set());

  return {
    hasPlaceholders: parsed.hasPlaceholder,
    referencedParameters: referenced,
    source: template,
    tokens: parsed.tokens,
  };
}

function emptyValueFor(type: ParameterType): ResolvedParameterValue {
  if (type === "number") {
    return { significant: false, value: "0" };
  }

  if (type === "bool") {
    return { significant: false, value: "false" };
  }

  return { significant: false, value: "" };
}

function canonicalizeNumber(raw: unknown): string | null {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 0) {
      return null;
    }

    return BigInt(raw).toString();
  }

  if (typeof raw === "string") {
    if (!DIGITS_PATTERN.test(raw)) {
      return null;
    }

    return raw.replace(LEADING_ZEROS_PATTERN, "");
  }

  return null;
}

function resolveText(name: string, raw: unknown): ResolvedParameterValue {
  const value = String(raw).trim();

  if (value.length > MAX_TEXT_LENGTH) {
    throw renderError(
      `Parameter "${name}" exceeds the maximum text length of ${MAX_TEXT_LENGTH} characters.`
    );
  }

  return { significant: value.length > 0, value };
}

function resolveNumber(name: string, raw: unknown): ResolvedParameterValue {
  const value = canonicalizeNumber(raw);

  if (value === null) {
    throw renderError(`Parameter "${name}" must be a non-negative integer.`);
  }

  return { significant: value !== "0", value };
}

function resolveBoolean(name: string, raw: unknown): ResolvedParameterValue {
  if (typeof raw === "boolean") {
    return { significant: raw, value: raw ? "true" : "false" };
  }

  if (typeof raw === "string") {
    const normalized = raw.toLowerCase();

    if (normalized === "true" || normalized === "1") {
      return { significant: true, value: "true" };
    }

    if (normalized === "false" || normalized === "0") {
      return { significant: false, value: "false" };
    }
  }

  throw renderError(`Parameter "${name}" must be a boolean (true/false/1/0).`);
}

function resolveParameterValue(
  name: string,
  definition: ParameterDefinition,
  supplied: string | number | boolean | null | undefined
): ResolvedParameterValue {
  const raw =
    supplied === undefined || supplied === null ? definition.default : supplied;

  const isBlank =
    raw === undefined ||
    raw === null ||
    (typeof raw === "string" && raw.trim() === "");

  if (isBlank) {
    if (definition.required) {
      throw renderError(`Parameter "${name}" is required but has no value.`);
    }

    return emptyValueFor(definition.type);
  }

  if (definition.type === "number") {
    return resolveNumber(name, raw);
  }

  if (definition.type === "bool") {
    return resolveBoolean(name, raw);
  }

  return resolveText(name, raw);
}

function renderTokens(
  tokens: readonly TemplateToken[],
  resolved: ReadonlyMap<string, ResolvedParameterValue>
): RenderedSequence {
  let text = "";
  let significant = false;

  for (const token of tokens) {
    if (token.kind === "literal") {
      text += token.value;
      continue;
    }

    if (token.kind === "placeholder") {
      const resolvedValue = resolved.get(token.name);

      if (!resolvedValue) {
        throw renderError(`Parameter "${token.name}" was not resolved.`);
      }

      text +=
        token.width === null
          ? resolvedValue.value
          : resolvedValue.value.padStart(token.width, "0");

      if (resolvedValue.significant) {
        significant = true;
      }

      continue;
    }

    const inner = renderTokens(token.tokens, resolved);

    if (inner.significant) {
      text += inner.text;
      significant = true;
    }
  }

  return { significant, text };
}

function hasReservedWindowsName(key: string): boolean {
  const dotIndex = key.indexOf(".");
  const basename = dotIndex === -1 ? key : key.slice(0, dotIndex);

  return WINDOWS_RESERVED_NAME_PATTERN.test(basename);
}

function validateRenderedKey(key: string): void {
  if (key.length === 0) {
    throw renderError("The rendered key must not be empty.");
  }

  if (Buffer.byteLength(key, "utf8") > MAX_KEY_BYTES) {
    throw renderError(
      `The rendered key must be at most ${MAX_KEY_BYTES} UTF-8 bytes.`
    );
  }

  if (key === "." || key === "..") {
    throw renderError(`The rendered key must not be "${key}".`);
  }

  if (hasControlCharacter(key)) {
    throw renderError("The rendered key must not contain control characters.");
  }

  if (containsCharacter(key, PATH_SEPARATOR_CHARACTERS)) {
    throw renderError("The rendered key must not contain path separators.");
  }

  if (containsCharacter(key, RESERVED_KEY_CHARACTERS)) {
    throw renderError(
      'The rendered key must not contain any of the reserved characters : * ? " < > |.'
    );
  }

  if (key.endsWith(" ") || key.endsWith(".")) {
    throw renderError("The rendered key must not end with a space or a dot.");
  }

  if (hasReservedWindowsName(key)) {
    throw renderError(
      `The rendered key must not use the reserved Windows device name "${key}".`
    );
  }
}

/**
 * Renders a key template with the supplied values. Missing values fall back to
 * the parameter default; required parameters are rejected when blank.
 */
export function renderKeyTemplate(
  template: string,
  parameters: ParameterDefinitions,
  values: Readonly<Record<string, string | number | boolean | null | undefined>>
): string {
  const parsed = parseKeyTemplate(template, parameters);
  const resolved = new Map<string, ResolvedParameterValue>();

  for (const name of parsed.referencedParameters) {
    resolved.set(
      name,
      resolveParameterValue(name, parameters[name], values[name])
    );
  }

  const rendered = renderTokens(parsed.tokens, resolved);
  validateRenderedKey(rendered.text);

  return rendered.text;
}
