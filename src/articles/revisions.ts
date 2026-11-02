/**
 * Revision-name matching.
 *
 * A revision is a real directory (never a symlink) whose name matches the
 * pattern produced by the customer's `revision.key` and parameter types. The
 * canonical number forms are part of the match: a placeholder without zero
 * padding accepts `0` and `1`, `2`, ... but never `01`; a padded placeholder
 * accepts exactly the padded width or a non-zero number that outgrew it.
 *
 * Matching is deterministic: the template is walked against the candidate name
 * with memoised dynamic programming, never by compiling a regular expression.
 * A regex built from adjacent/optional placeholders can backtrack
 * catastrophically on hostile input (a key such as `{A}-{B}-...` against a long
 * non-matching folder name froze the main process), whereas the memoised walk
 * visits each (token position, name position) state once. A shared work budget
 * per matcher bounds even that walk, so a pathological template aborts instead
 * of blocking the event loop.
 */

import type { Dirent } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
import path from "node:path";
import {
  type ParsedKeyTemplate,
  parseKeyTemplate,
  type TemplateToken,
} from "../customers/key-template";
import type {
  CustomerSectionDefinition,
  ParameterDefinitions,
} from "../customers/types";
import { ArticleServiceError } from "./errors";

const DEFAULT_MAX_REVISION_ENTRIES = 10_000;

/** A single text placeholder accepts at most 255 characters. */
const MAX_TEXT_COMPONENT_LENGTH = 255;

/** The longest canonical number a folder name can carry. */
const MAX_NUMBER_DIGITS = 254;

/** Bounds that keep the walk and its state space small. */
const MAX_PLACEHOLDERS = 8;
const MAX_OPTIONAL_GROUPS = 4;
const MAX_TOKENS = 32;

/**
 * Work units one matcher may spend across every name it tests. The budget is
 * shared by all names of one article: a hostile template cannot multiply its
 * cost by the number of revision folders.
 */
const DEFAULT_MATCH_BUDGET = 2_000_000;

const TEXT_FORBIDDEN_CODES: ReadonlySet<number> = new Set([
  0x22, // "
  0x2a, // *
  0x2f, // /
  0x3a, // :
  0x3c, // <
  0x3e, // >
  0x3f, // ?
  0x5c, // \
  0x7c, // |
]);

function isTextCodeAllowed(code: number): boolean {
  return code >= 0x20 && code !== 0x7f && !TEXT_FORBIDDEN_CODES.has(code);
}

function isDigitCode(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

type FlatToken =
  | { readonly kind: "literal" }
  | { readonly kind: "placeholder" };

/**
 * Flattens tokens into literals and placeholders. With `expandOptionals`, the
 * contents of an optional group are inlined; without it, the whole group is
 * dropped, modelling both possible rendered forms of the key.
 */
function flattenTokens(
  tokens: readonly TemplateToken[],
  expandOptionals: boolean
): FlatToken[] {
  const flattened: FlatToken[] = [];

  for (const token of tokens) {
    if (token.kind === "literal") {
      flattened.push({ kind: "literal" });
      continue;
    }

    if (token.kind === "placeholder") {
      flattened.push({ kind: "placeholder" });
      continue;
    }

    if (expandOptionals) {
      flattened.push(...flattenTokens(token.tokens, true));
    }
  }

  return flattened;
}

function hasAdjacentPlaceholders(tokens: readonly FlatToken[]): boolean {
  for (let index = 1; index < tokens.length; index += 1) {
    if (
      tokens[index - 1]?.kind === "placeholder" &&
      tokens[index]?.kind === "placeholder"
    ) {
      return true;
    }
  }

  return false;
}

function countPlaceholders(tokens: readonly TemplateToken[]): number {
  let count = 0;

  for (const token of tokens) {
    if (token.kind === "placeholder") {
      count += 1;
      continue;
    }

    if (token.kind === "optional") {
      count += countPlaceholders(token.tokens);
    }
  }

  return count;
}

function countOptionalGroups(tokens: readonly TemplateToken[]): number {
  let count = 0;

  for (const token of tokens) {
    if (token.kind === "optional") {
      count += 1 + countOptionalGroups(token.tokens);
    }
  }

  return count;
}

function countTokens(tokens: readonly TemplateToken[]): number {
  let count = 0;

  for (const token of tokens) {
    count += 1;

    if (token.kind === "optional") {
      count += countTokens(token.tokens);
    }
  }

  return count;
}

function invalidTemplate(message: string): ArticleServiceError {
  return new ArticleServiceError("ARTICLE_DATA_INVALID", message);
}

/**
 * Rejects templates whose expanded or removed optional forms would put two
 * placeholders next to each other, or that exceed the state-space caps.
 */
function assertSafeRevisionTemplate(parsed: ParsedKeyTemplate): void {
  const placeholderCount = countPlaceholders(parsed.tokens);

  if (placeholderCount > MAX_PLACEHOLDERS) {
    throw invalidTemplate(
      `The revision key contains ${placeholderCount} placeholders; the maximum is ${MAX_PLACEHOLDERS}.`
    );
  }

  const optionalGroupCount = countOptionalGroups(parsed.tokens);

  if (optionalGroupCount > MAX_OPTIONAL_GROUPS) {
    throw invalidTemplate(
      `The revision key contains ${optionalGroupCount} optional groups; the maximum is ${MAX_OPTIONAL_GROUPS}.`
    );
  }

  if (countTokens(parsed.tokens) > MAX_TOKENS) {
    throw invalidTemplate(
      `The revision key contains too many tokens; the maximum is ${MAX_TOKENS}.`
    );
  }

  if (
    hasAdjacentPlaceholders(flattenTokens(parsed.tokens, true)) ||
    hasAdjacentPlaceholders(flattenTokens(parsed.tokens, false))
  ) {
    throw invalidTemplate(
      "The revision key must not contain adjacent placeholders."
    );
  }
}

/**
 * A matcher for revision folder names. `test` returns whether the whole name
 * can be produced by the template. The type intentionally mirrors `RegExp.test`
 * so callers do not depend on how the match is implemented.
 */
export interface RevisionNameMatcher {
  test(name: string): boolean;
}

export interface BuildRevisionNamePatternOptions {
  /** Test seam: override the matcher's total work budget. */
  readonly budget?: number;
}

interface MatchState {
  readonly ids: WeakMap<readonly TemplateToken[], number>;
  readonly memo: Map<string, Set<number>>;
  readonly name: string;
  nextId: number;
  readonly parameters: ParameterDefinitions;
  remaining: number;
}

function charge(state: MatchState, amount = 1): void {
  state.remaining -= amount;

  if (state.remaining < 0) {
    throw new ArticleServiceError(
      "READ_FAILED",
      "The revision key is too complex to match against folder names."
    );
  }
}

function listId(state: MatchState, tokens: readonly TemplateToken[]): number {
  const existing = state.ids.get(tokens);

  if (existing !== undefined) {
    return existing;
  }

  const id = state.nextId;
  state.nextId += 1;
  state.ids.set(tokens, id);

  return id;
}

/**
 * End positions reachable by consuming one placeholder. A number is canonical
 * only without leading zeros; a padded number is either exactly `width` digits
 * or a non-zero number that outgrew the width.
 */
function consumePlaceholder(
  state: MatchState,
  token: {
    readonly kind: "placeholder";
    readonly name: string;
    readonly width: number | null;
  },
  start: number
): number[] {
  const definition = state.parameters[token.name];

  if (!definition) {
    throw new ArticleServiceError(
      "ARTICLE_DATA_INVALID",
      `Revision parameter "${token.name}" is not declared.`
    );
  }

  const { name } = state;
  const first = name.charCodeAt(start);

  if (Number.isNaN(first)) {
    return [];
  }

  if (definition.type === "bool") {
    const ends: number[] = [];

    if (name.startsWith("true", start)) {
      charge(state, 4);
      ends.push(start + 4);
    }

    if (name.startsWith("false", start)) {
      charge(state, 5);
      ends.push(start + 5);
    }

    return ends;
  }

  if (definition.type === "number") {
    const ends: number[] = [];

    if (token.width === null) {
      if (first === 0x30) {
        charge(state);
        return [start + 1];
      }

      if (!isDigitCode(first) || first === 0x30) {
        return [];
      }

      const limit = Math.min(name.length, start + MAX_NUMBER_DIGITS);

      for (let end = start + 1; end <= limit; end += 1) {
        charge(state);

        if (!isDigitCode(name.charCodeAt(end - 1))) {
          break;
        }

        ends.push(end);
      }

      return ends;
    }

    // A width wider than any folder name can never match.
    if (token.width > MAX_TEXT_COMPONENT_LENGTH) {
      return [];
    }

    const paddedEnd = start + token.width;

    if (paddedEnd <= name.length) {
      let allDigits = true;

      for (let index = start; index < paddedEnd; index += 1) {
        charge(state);

        if (!isDigitCode(name.charCodeAt(index))) {
          allDigits = false;
          break;
        }
      }

      if (allDigits) {
        ends.push(paddedEnd);
      }
    }

    if (first !== 0x30 && isDigitCode(first)) {
      const limit = Math.min(name.length, start + MAX_NUMBER_DIGITS);

      for (let end = start + 1; end <= limit; end += 1) {
        charge(state);

        if (!isDigitCode(name.charCodeAt(end - 1))) {
          break;
        }

        if (end >= paddedEnd && end !== paddedEnd) {
          ends.push(end);
        }
      }
    }

    return ends;
  }

  const ends: number[] = [];
  const limit = Math.min(name.length, start + MAX_TEXT_COMPONENT_LENGTH);

  for (let end = start + 1; end <= limit; end += 1) {
    charge(state);

    if (!isTextCodeAllowed(name.charCodeAt(end - 1))) {
      break;
    }

    ends.push(end);
  }

  return ends;
}

function matchList(
  state: MatchState,
  tokens: readonly TemplateToken[],
  index: number,
  position: number
): Set<number> {
  const id = listId(state, tokens);
  const key = `${id}:${index}:${position}`;
  const memoized = state.memo.get(key);

  if (memoized !== undefined) {
    return memoized;
  }

  charge(state);

  const results = new Set<number>();

  if (index >= tokens.length) {
    results.add(position);
    state.memo.set(key, results);

    return results;
  }

  const token = tokens[index];

  if (token === undefined) {
    results.add(position);
    state.memo.set(key, results);

    return results;
  }

  if (token.kind === "optional") {
    for (const skipped of matchList(state, tokens, index + 1, position)) {
      results.add(skipped);
    }

    for (const afterGroup of matchList(state, token.tokens, 0, position)) {
      for (const resumed of matchList(state, tokens, index + 1, afterGroup)) {
        results.add(resumed);
      }
    }

    state.memo.set(key, results);

    return results;
  }

  const ends =
    token.kind === "literal"
      ? state.name.startsWith(token.value, position)
        ? [position + token.value.length]
        : []
      : consumePlaceholder(state, token, position);

  for (const end of ends) {
    charge(state);

    for (const resumed of matchList(state, tokens, index + 1, end)) {
      results.add(resumed);
    }
  }

  state.memo.set(key, results);

  return results;
}

class DeterministicRevisionMatcher implements RevisionNameMatcher {
  private readonly parameters: ParameterDefinitions;

  private readonly tokens: readonly TemplateToken[];

  /** Shared across `test` calls so one hostile key cannot multiply its cost. */
  private remaining: number;

  constructor(
    tokens: readonly TemplateToken[],
    parameters: ParameterDefinitions,
    budget: number
  ) {
    this.tokens = tokens;
    this.parameters = parameters;
    this.remaining = budget;
  }

  test(name: string): boolean {
    const state: MatchState = {
      ids: new WeakMap(),
      memo: new Map(),
      name,
      nextId: 0,
      parameters: this.parameters,
      remaining: this.remaining,
    };

    const ends = matchList(state, this.tokens, 0, 0);
    this.remaining = state.remaining;

    return ends.has(name.length);
  }
}

/**
 * Builds a deterministic matcher for a revision section.
 */
export function buildRevisionNamePattern(
  revision: CustomerSectionDefinition,
  options: BuildRevisionNamePatternOptions = {}
): RevisionNameMatcher {
  const parsed = parseKeyTemplate(revision.key, revision.parameters);

  assertSafeRevisionTemplate(parsed);

  return new DeterministicRevisionMatcher(
    parsed.tokens,
    revision.parameters,
    options.budget ?? DEFAULT_MATCH_BUDGET
  );
}

/**
 * `DT_UNKNOWN` on some network/FUSE filesystems means the `Dirent` can answer
 * neither `isDirectory()` nor `isFile()`. Falling back to `lstat` (never
 * `stat`) keeps symlinks excluded.
 */
async function isRealDirectory(
  entry: Dirent,
  entryPath: string
): Promise<boolean> {
  if (entry.isSymbolicLink()) {
    return false;
  }

  if (entry.isDirectory()) {
    return true;
  }

  if (entry.isFile()) {
    return false;
  }

  try {
    const stats = await lstat(entryPath, { throwIfNoEntry: false });

    return (
      stats !== undefined && !stats.isSymbolicLink() && stats.isDirectory()
    );
  } catch {
    return false;
  }
}

/**
 * Keeps the `throw` out of catch blocks so the original failure can be
 * forwarded as `cause` without the linter losing track of it.
 */
function revisionReadError(
  message: string,
  cause: unknown
): ArticleServiceError {
  return new ArticleServiceError("READ_FAILED", message, { cause });
}

export interface CountValidRevisionsOptions {
  /** Test seam: override the 10,000-entry safety budget. */
  readonly maxEntries?: number;
}

/**
 * Counts revision directories inside an article folder. Symlinks and plain
 * files are ignored. The folder is streamed with `opendir`, so the entry budget
 * is enforced without materialising the full listing: exceeding it throws
 * instead of returning a partial count.
 */
export async function countValidRevisions(
  articleFolderPath: string,
  revision: CustomerSectionDefinition,
  options: CountValidRevisionsOptions = {}
): Promise<number> {
  if (articleFolderPath.includes("\0")) {
    throw new ArticleServiceError(
      "ARTICLE_PATH_INVALID",
      `Article folder path contains a NUL character: "${articleFolderPath}"`
    );
  }

  const resolved = path.resolve(articleFolderPath);
  const pattern = buildRevisionNamePattern(revision);
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_REVISION_ENTRIES;
  let count = 0;

  try {
    const directory = await opendir(resolved);

    try {
      let entryCount = 0;

      for await (const entry of directory) {
        entryCount += 1;

        if (entryCount > maxEntries) {
          throw new ArticleServiceError(
            "READ_FAILED",
            `Article folder "${resolved}" has more than ${maxEntries} entries; the maximum is ${maxEntries}. The revision count cannot be determined.`
          );
        }

        if (entry.name.startsWith(".")) {
          continue;
        }

        const entryPath = path.join(resolved, entry.name);

        if (!(await isRealDirectory(entry, entryPath))) {
          continue;
        }

        if (pattern.test(entry.name)) {
          count += 1;
        }
      }
    } finally {
      await directory.close().catch(() => undefined);
    }
  } catch (error) {
    if (error instanceof ArticleServiceError) {
      throw error;
    }

    throw revisionReadError(
      `Unable to read article folder "${resolved}".`,
      error
    );
  }

  return count;
}
