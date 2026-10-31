import type {
  CustomerSectionDefinition,
  ParameterType,
} from "@/customers/types";
import type { TranslationKey } from "@/localization/resources/it";

export interface ParameterDraft {
  defaultValue: string;
  id: string;
  name: string;
  required: boolean;
  type: ParameterType;
}

export interface SectionDraft {
  key: string;
  parameters: ParameterDraft[];
  schemaVersion: number;
}

export type SectionErrorCode =
  | "defaultBool"
  | "defaultNumber"
  | "keyNoPlaceholder"
  | "keyPlaceholder"
  | "keyRequired"
  | "keyTooLong"
  | "parameterDuplicate"
  | "parameterName"
  | "parameterRequired";

export interface ParameterErrors {
  default?: SectionErrorCode;
  name?: SectionErrorCode;
}

export interface SectionErrors {
  key?: SectionErrorCode;
  parameters: Record<string, ParameterErrors>;
  section?: SectionErrorCode;
}

export const SECTION_ERROR_MESSAGE_KEYS: Record<
  SectionErrorCode,
  TranslationKey
> = {
  defaultBool: "customersFormErrorBoolDefault",
  defaultNumber: "customersFormErrorNumberDefault",
  keyNoPlaceholder: "customersFormErrorKeyNoPlaceholder",
  keyPlaceholder: "customersFormErrorKeyPlaceholder",
  keyRequired: "customersFormErrorKeyRequired",
  keyTooLong: "customersFormErrorKeyTooLong",
  parameterDuplicate: "customersFormErrorDuplicateParameter",
  parameterName: "customersFormErrorParameterName",
  parameterRequired: "customersFormErrorParameterRequired",
};

const PARAMETER_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;
const PLACEHOLDER_PATTERN = /\{(?<placeholder>[^{}]+)\}/gu;
const NUMBER_DEFAULT_PATTERN = /^\d+$/u;
const BOOL_DEFAULT_PATTERN = /^(?<value>true|false|1|0)$/iu;
const MAX_KEY_LENGTH = 512;

export const DEFAULT_ARTICLE_KEY = "{CODE}[_EVO{EVO:00}]";
export const DEFAULT_REVISION_KEY = "REV_{REV}";

let parameterSequence = 0;

/** A fresh object per call: parameter drafts must never be shared or mutated. */
export function createParameterDraft(
  name: string,
  type: ParameterType,
  required: boolean,
  defaultValue: string
): ParameterDraft {
  parameterSequence += 1;

  return {
    defaultValue,
    id: `parameter-${parameterSequence}`,
    name,
    required,
    type,
  };
}

export function createDefaultArticleDraft(): SectionDraft {
  return {
    key: DEFAULT_ARTICLE_KEY,
    parameters: [
      createParameterDraft("CODE", "text", true, ""),
      createParameterDraft("EVO", "number", true, "0"),
    ],
    schemaVersion: 1,
  };
}

export function createDefaultRevisionDraft(): SectionDraft {
  return {
    key: DEFAULT_REVISION_KEY,
    parameters: [createParameterDraft("REV", "number", true, "0")],
    schemaVersion: 1,
  };
}

export function sectionToDraft(
  section: CustomerSectionDefinition
): SectionDraft {
  return {
    key: section.key,
    parameters: Object.entries(section.parameters).map(([name, definition]) =>
      createParameterDraft(
        name,
        definition.type,
        definition.required,
        definition.default ?? ""
      )
    ),
    schemaVersion: section.schemaVersion,
  };
}

/**
 * Converts the editor draft into the wire shape. The backend re-validates the
 * template (the renderer deliberately does not run the main-process key
 * engine), so this only normalises whitespace and drops empty defaults.
 */
export function buildSectionInput(
  draft: SectionDraft
): CustomerSectionDefinition {
  const parameters: Record<
    string,
    {
      default?: string;
      required: boolean;
      type: ParameterType;
    }
  > = {};

  for (const parameter of draft.parameters) {
    const name = parameter.name.trim();
    const defaultValue = parameter.defaultValue.trim();

    parameters[name] = {
      required: parameter.required,
      type: parameter.type,
      ...(defaultValue === "" ? {} : { default: defaultValue }),
    };
  }

  return {
    key: draft.key.trim(),
    parameters,
    schemaVersion: 1,
  };
}

export function placeholderNames(key: string): string[] {
  const names: string[] = [];

  for (const match of key.matchAll(PLACEHOLDER_PATTERN)) {
    const placeholder = match.groups?.placeholder;

    if (placeholder === undefined) {
      continue;
    }

    const [name] = placeholder.split(":");

    names.push(name);
  }

  return names;
}

function countParameterNames(draft: SectionDraft): Map<string, number> {
  const counts = new Map<string, number>();

  for (const parameter of draft.parameters) {
    const name = parameter.name.trim();

    if (name !== "") {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  return counts;
}

function validateParameterName(
  name: string,
  counts: Map<string, number>
): SectionErrorCode | undefined {
  if (name === "" || !PARAMETER_NAME_PATTERN.test(name)) {
    return "parameterName";
  }

  if ((counts.get(name) ?? 0) > 1) {
    return "parameterDuplicate";
  }

  return undefined;
}

function validateParameterDefault(
  parameter: SectionDraft["parameters"][number]
): SectionErrorCode | undefined {
  const defaultValue = parameter.defaultValue.trim();

  if (defaultValue === "") {
    return undefined;
  }

  if (
    parameter.type === "number" &&
    !NUMBER_DEFAULT_PATTERN.test(defaultValue)
  ) {
    return "defaultNumber";
  }

  if (parameter.type === "bool" && !BOOL_DEFAULT_PATTERN.test(defaultValue)) {
    return "defaultBool";
  }

  return undefined;
}

function validateParameters(draft: SectionDraft): {
  errors: Record<string, ParameterErrors>;
  names: Set<string>;
} {
  const errors: Record<string, ParameterErrors> = {};
  const counts = countParameterNames(draft);
  const names = new Set<string>();

  for (const parameter of draft.parameters) {
    const name = parameter.name.trim();
    const nameError = validateParameterName(name, counts);
    const defaultError = validateParameterDefault(parameter);

    if (name !== "") {
      names.add(name);
    }

    errors[parameter.id] = {
      ...(defaultError === undefined ? {} : { default: defaultError }),
      ...(nameError === undefined ? {} : { name: nameError }),
    };
  }

  return { errors, names };
}

export function validateSection(draft: SectionDraft): SectionErrors {
  const { errors, names } = validateParameters(draft);
  const trimmedKey = draft.key.trim();
  const sectionErrors: SectionErrors = { parameters: errors };

  if (trimmedKey === "") {
    sectionErrors.key = "keyRequired";
  } else if (trimmedKey.length > MAX_KEY_LENGTH) {
    sectionErrors.key = "keyTooLong";
  } else {
    const placeholders = placeholderNames(trimmedKey);

    if (placeholders.length === 0) {
      sectionErrors.key = "keyNoPlaceholder";
    } else if (placeholders.some((name) => !names.has(name))) {
      sectionErrors.key = "keyPlaceholder";
    }
  }

  if (draft.parameters.length === 0) {
    sectionErrors.section = "parameterRequired";
  }

  return sectionErrors;
}

export function hasSectionErrors(errors: SectionErrors): boolean {
  return (
    errors.key !== undefined ||
    errors.section !== undefined ||
    Object.values(errors.parameters).some(
      (parameterErrors) =>
        parameterErrors.name !== undefined ||
        parameterErrors.default !== undefined
    )
  );
}
