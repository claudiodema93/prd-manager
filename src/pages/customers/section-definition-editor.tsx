import { Lock, Plus, Trash2 } from "lucide-react";
import type { ChangeEvent } from "react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ParameterType } from "@/customers/types";
import type { TranslationKey } from "@/localization/resources/it";
import {
  createParameterDraft,
  type ParameterDraft,
  type ParameterErrors,
  placeholderNames,
  SECTION_ERROR_MESSAGE_KEYS,
  type SectionDraft,
  type SectionErrors,
} from "./section-draft";

interface SectionDefinitionEditorProps {
  description: string;
  disabled?: boolean;
  errors: SectionErrors;
  idPrefix: string;
  keyDisabled?: boolean;
  keyDisabledReason?: string;
  onChange: (next: SectionDraft) => void;
  section: SectionDraft;
  showErrors?: boolean;
  title: string;
}

interface ParameterRowProps {
  disabled: boolean;
  errors: ParameterErrors;
  idPrefix: string;
  index: number;
  nameLocked: boolean;
  onRemove: (parameterId: string) => void;
  onUpdate: (parameterId: string, changes: Partial<ParameterDraft>) => void;
  parameter: ParameterDraft;
  removable: boolean;
  showErrors: boolean;
}

const MAX_PARAMETERS = 64;

const TYPE_OPTIONS: { labelKey: TranslationKey; value: ParameterType }[] = [
  { labelKey: "customersFormTypeText", value: "text" },
  { labelKey: "customersFormTypeNumber", value: "number" },
  { labelKey: "customersFormTypeBool", value: "bool" },
];

function ParameterRow({
  disabled,
  errors,
  idPrefix,
  index,
  nameLocked,
  onRemove,
  onUpdate,
  parameter,
  removable,
  showErrors,
}: ParameterRowProps) {
  const { t } = useTranslation();
  const nameErrorId = `${idPrefix}-${parameter.id}-name-error`;
  const defaultErrorId = `${idPrefix}-${parameter.id}-default-error`;
  const showNameError = showErrors && errors.name !== undefined;
  const showDefaultError = showErrors && errors.default !== undefined;

  const handleNameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onUpdate(parameter.id, { name: event.target.value.toUpperCase() });
    },
    [onUpdate, parameter.id]
  );

  const handleDefaultChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onUpdate(parameter.id, { defaultValue: event.target.value });
    },
    [onUpdate, parameter.id]
  );

  const handleTypeChange = useCallback(
    (value: string) => {
      if (value === "text" || value === "number" || value === "bool") {
        onUpdate(parameter.id, { type: value });
      }
    },
    [onUpdate, parameter.id]
  );

  const handleRequiredChange = useCallback(
    (checked: boolean) => {
      onUpdate(parameter.id, { required: checked });
    },
    [onUpdate, parameter.id]
  );

  const handleRemove = useCallback(() => {
    onRemove(parameter.id);
  }, [onRemove, parameter.id]);

  return (
    <div className="bg-muted/30 flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs font-medium">
          {t("customersFormParameterHeading", { index: index + 1 })}
        </span>
        <Button
          aria-label={t("customersFormRemoveParameter", { index: index + 1 })}
          disabled={disabled || !removable || nameLocked}
          onClick={handleRemove}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Trash2 />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto_minmax(0,1fr)] sm:items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-${parameter.id}-name`}>
            {t("customersFormParameterName")}
          </Label>
          <Input
            aria-describedby={showNameError ? nameErrorId : undefined}
            aria-invalid={showNameError}
            className="font-mono uppercase"
            disabled={disabled || nameLocked}
            id={`${idPrefix}-${parameter.id}-name`}
            onChange={handleNameChange}
            spellCheck={false}
            value={parameter.name}
          />
          {showNameError && errors.name ? (
            <p
              className="text-destructive text-xs"
              id={nameErrorId}
              role="alert"
            >
              {t(SECTION_ERROR_MESSAGE_KEYS[errors.name])}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-${parameter.id}-type`}>
            {t("customersFormParameterType")}
          </Label>
          <Select
            disabled={disabled}
            onValueChange={handleTypeChange}
            value={parameter.type}
          >
            <SelectTrigger
              className="w-full"
              id={`${idPrefix}-${parameter.id}-type`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-${parameter.id}-required`}>
            {t("customersFormParameterRequired")}
          </Label>
          <Switch
            checked={parameter.required}
            disabled={disabled}
            id={`${idPrefix}-${parameter.id}-required`}
            onCheckedChange={handleRequiredChange}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-${parameter.id}-default`}>
            {t("customersFormParameterDefault")}
          </Label>
          <Input
            aria-describedby={showDefaultError ? defaultErrorId : undefined}
            aria-invalid={showDefaultError}
            disabled={disabled}
            id={`${idPrefix}-${parameter.id}-default`}
            inputMode={parameter.type === "number" ? "numeric" : undefined}
            maxLength={256}
            onChange={handleDefaultChange}
            placeholder={t("customersFormParameterDefaultPlaceholder")}
            value={parameter.defaultValue}
          />
          {showDefaultError && errors.default ? (
            <p
              className="text-destructive text-xs"
              id={defaultErrorId}
              role="alert"
            >
              {t(SECTION_ERROR_MESSAGE_KEYS[errors.default])}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function SectionDefinitionEditor({
  description,
  disabled = false,
  errors,
  idPrefix,
  keyDisabled = false,
  keyDisabledReason,
  onChange,
  section,
  showErrors = false,
  title,
}: SectionDefinitionEditorProps) {
  const { t } = useTranslation();
  const lockedNames = keyDisabled
    ? new Set(placeholderNames(section.key))
    : new Set<string>();

  function updateParameter(
    parameterId: string,
    changes: Partial<ParameterDraft>
  ) {
    onChange({
      ...section,
      parameters: section.parameters.map((parameter) =>
        parameter.id === parameterId ? { ...parameter, ...changes } : parameter
      ),
    });
  }

  function handleKeyChange(event: ChangeEvent<HTMLInputElement>) {
    if (keyDisabled) {
      return;
    }

    onChange({ ...section, key: event.target.value });
  }

  function handleAddParameter() {
    if (section.parameters.length >= MAX_PARAMETERS) {
      return;
    }

    onChange({
      ...section,
      parameters: [
        ...section.parameters,
        createParameterDraft("", "text", false, ""),
      ],
    });
  }

  function handleRemoveParameter(parameterId: string) {
    if (section.parameters.length <= 1) {
      return;
    }

    const parameter = section.parameters.find(
      (item) => item.id === parameterId
    );

    if (parameter !== undefined && lockedNames.has(parameter.name.trim())) {
      return;
    }

    onChange({
      ...section,
      parameters: section.parameters.filter((item) => item.id !== parameterId),
    });
  }

  const keyHelpId = `${idPrefix}-key-help`;
  const keyErrorId = `${idPrefix}-key-error`;
  const keyLockId = `${idPrefix}-key-lock`;
  const showKeyError = showErrors && errors.key !== undefined;
  const describedBy = [keyHelpId];

  if (keyDisabled && keyDisabledReason) {
    describedBy.push(keyLockId);
  }

  if (showKeyError) {
    describedBy.push(keyErrorId);
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-key`}>{t("customersFormKeyLabel")}</Label>
        <div className="relative">
          <Input
            aria-describedby={describedBy.join(" ")}
            aria-invalid={showKeyError}
            aria-label={`${title}: ${t("customersFormKeyLabel")}`}
            aria-readonly={keyDisabled}
            aria-required="true"
            className="pr-8 font-mono"
            disabled={disabled}
            id={`${idPrefix}-key`}
            onChange={handleKeyChange}
            readOnly={keyDisabled}
            spellCheck={false}
            value={section.key}
          />
          {keyDisabled ? (
            <Lock
              aria-hidden="true"
              className="text-muted-foreground pointer-events-none absolute top-1.5 right-2 size-3.5"
            />
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs" id={keyHelpId}>
          {t("customersFormKeyHelper")}{" "}
          <span className="font-mono">{t("customersFormKeyExample")}</span>
        </p>
        {keyDisabledReason ? (
          <p
            className="text-muted-foreground flex items-center gap-1 text-xs"
            id={keyLockId}
          >
            <Lock aria-hidden="true" className="size-3" />
            {keyDisabledReason}
          </p>
        ) : null}
        {keyDisabled ? (
          <p className="text-muted-foreground flex items-center gap-1 text-xs">
            <Lock aria-hidden="true" className="size-3" />
            {t("customersFormKeyNamesLocked")}
          </p>
        ) : null}
        {showKeyError && errors.key ? (
          <p className="text-destructive text-xs" id={keyErrorId} role="alert">
            {t(SECTION_ERROR_MESSAGE_KEYS[errors.key])}
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium">
          {t("customersFormParametersTitle")}
        </h4>
        <Button
          disabled={disabled || section.parameters.length >= MAX_PARAMETERS}
          onClick={handleAddParameter}
          size="sm"
          type="button"
          variant="outline"
        >
          <Plus />
          {t("customersFormAddParameter")}
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        {section.parameters.map((parameter, index) => (
          <ParameterRow
            disabled={disabled}
            errors={errors.parameters[parameter.id] ?? {}}
            idPrefix={idPrefix}
            index={index}
            key={parameter.id}
            nameLocked={lockedNames.has(parameter.name.trim())}
            onRemove={handleRemoveParameter}
            onUpdate={updateParameter}
            parameter={parameter}
            removable={section.parameters.length > 1}
            showErrors={showErrors}
          />
        ))}
        {showErrors && errors.section ? (
          <p className="text-destructive text-xs" role="alert">
            {t(SECTION_ERROR_MESSAGE_KEYS[errors.section])}
          </p>
        ) : null}
      </div>
    </section>
  );
}
