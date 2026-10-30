import { cn } from "cn";
import {
  CircleAlert,
  CircleX,
  LoaderCircle,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  createCustomer,
  getCustomer,
  updateCustomer,
} from "@/actions/customers";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type { TranslationKey } from "@/localization/resources/it";
import {
  CUSTOMER_ERROR_MESSAGE_KEYS,
  CUSTOMER_ISSUE_MESSAGE_KEYS,
  type CustomerErrorInfo,
  describeCustomerError,
  toLoggableCustomerError,
} from "./customer-errors";
import type { CustomerIssue, CustomerSummary } from "./customer-types";
import SectionDefinitionEditor from "./section-definition-editor";
import {
  buildSectionInput,
  createDefaultArticleDraft,
  createDefaultRevisionDraft,
  hasSectionErrors,
  type SectionDraft,
  type SectionErrors,
  sectionToDraft,
  validateSection,
} from "./section-draft";
import TechnicalDetails from "./technical-details";

interface CustomerFormSheetProps {
  customer?: CustomerSummary | null;
  mode: "create" | "edit";
  onClose: () => void;
  onSaved: (mode: "create" | "edit") => void;
}

interface SnapshotInput {
  article: SectionDraft;
  code: string;
  name: string;
  revision: SectionDraft;
}

interface FormFieldsProps {
  article: SectionDraft;
  articleErrors: SectionErrors;
  code: string;
  codeError: TranslationKey | null;
  folderName: string;
  isEdit: boolean;
  issues: CustomerIssue[];
  keyLocked: boolean;
  keyLockedReason: string | undefined;
  metadataBlocked: boolean;
  metadataMissing: boolean;
  name: string;
  nameError: TranslationKey | null;
  nameInputRef: RefObject<HTMLInputElement | null>;
  onArticleChange: (next: SectionDraft) => void;
  onCodeChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onRevisionChange: (next: SectionDraft) => void;
  revision: SectionDraft;
  revisionErrors: SectionErrors;
  saving: boolean;
  showCodeError: boolean;
  showErrors: boolean;
  showNameError: boolean;
}

interface BasicsFieldsProps {
  code: string;
  codeError: TranslationKey | null;
  folderName: string;
  isEdit: boolean;
  name: string;
  nameError: TranslationKey | null;
  nameInputRef: RefObject<HTMLInputElement | null>;
  onCodeChange: (value: string) => void;
  onNameChange: (value: string) => void;
  saving: boolean;
  showCodeError: boolean;
  showNameError: boolean;
}

const CODE_PATTERN = /^(?!0000)\d{4}$/u;

function buildSnapshot({ article, code, name, revision }: SnapshotInput) {
  return JSON.stringify({
    article: buildSectionInput(article),
    code,
    name: name.trim(),
    revision: buildSectionInput(revision),
  });
}

interface FormValidationInput {
  article: SectionDraft;
  articleCount: number;
  code: string;
  initialSnapshot: string | null;
  isEdit: boolean;
  loadError: string | null;
  loading: boolean;
  metadataMissing: boolean;
  name: string;
  revision: SectionDraft;
  snapshot: string;
  submitted: boolean;
}

interface FormValidation {
  articleErrors: SectionErrors;
  canSubmit: boolean;
  codeError: TranslationKey | null;
  isDirty: boolean;
  keyLocked: boolean;
  metadataBlocked: boolean;
  nameError: TranslationKey | null;
  revisionErrors: SectionErrors;
  showCodeError: boolean;
  showNameError: boolean;
}

function validateForm({
  article,
  articleCount,
  code,
  initialSnapshot,
  isEdit,
  loadError,
  loading,
  metadataMissing,
  name,
  revision,
  snapshot,
  submitted,
}: FormValidationInput): FormValidation {
  const articleErrors = validateSection(article);
  const revisionErrors = validateSection(revision);
  const trimmedName = name.trim();
  const trimmedCode = code.trim();
  const nameError: TranslationKey | null =
    trimmedName === "" ? "customersFormErrorName" : null;
  const codeError: TranslationKey | null =
    !isEdit && trimmedCode !== "" && !CODE_PATTERN.test(trimmedCode)
      ? "customersFormErrorCode"
      : null;
  const sectionsValid = !(
    hasSectionErrors(articleErrors) || hasSectionErrors(revisionErrors)
  );
  const metadataBlocked = isEdit && metadataMissing && articleCount > 0;
  const keyLocked = isEdit && articleCount > 0;
  const isDirty =
    !loading && initialSnapshot !== null && snapshot !== initialSnapshot;
  const canSubmit =
    !loading &&
    loadError === null &&
    !metadataBlocked &&
    trimmedName !== "" &&
    codeError === null &&
    sectionsValid;

  return {
    articleErrors,
    canSubmit,
    codeError,
    isDirty,
    keyLocked,
    metadataBlocked,
    nameError,
    revisionErrors,
    showCodeError: submitted && codeError !== null,
    showNameError: submitted && nameError !== null,
  };
}

function FormLoading() {
  const { t } = useTranslation();

  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">{t("customersLoading")}</span>
      <Skeleton className="h-7 w-full" />
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

function ValidationSummary({
  error,
  summaryRef,
}: {
  error: CustomerErrorInfo | null;
  summaryRef: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();

  return (
    <div
      className="border-destructive/40 bg-destructive/10 text-destructive focus:border-destructive/60 focus:ring-destructive/30 mb-4 flex items-start gap-2 rounded-md border px-3 py-2 text-xs outline-none focus:ring-2"
      data-testid="customer-form-error-summary"
      ref={summaryRef}
      role="alert"
      tabIndex={-1}
    >
      <CircleX aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-medium">{t("customersFormValidationSummary")}</p>
        {error === null ? null : (
          <p>{t(CUSTOMER_ERROR_MESSAGE_KEYS[error.kind])}</p>
        )}
        {error === null ? null : <TechnicalDetails message={error.detail} />}
      </div>
    </div>
  );
}

function BasicsFields({
  code,
  codeError,
  folderName,
  isEdit,
  name,
  nameError,
  nameInputRef,
  onCodeChange,
  onNameChange,
  saving,
  showCodeError,
  showNameError,
}: BasicsFieldsProps) {
  const { t } = useTranslation();

  const handleNameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onNameChange(event.target.value);
    },
    [onNameChange]
  );

  const handleCodeChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onCodeChange(event.target.value);
    },
    [onCodeChange]
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="customer-name">
          {t("customersFormNameLabel")}{" "}
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
        </Label>
        <Input
          aria-describedby={
            showNameError
              ? "customer-name-required customer-name-error"
              : "customer-name-required"
          }
          aria-invalid={showNameError}
          aria-required="true"
          autoComplete="off"
          disabled={saving}
          id="customer-name"
          maxLength={256}
          onChange={handleNameChange}
          placeholder={t("customersFormNamePlaceholder")}
          ref={nameInputRef}
          value={name}
        />
        <span className="sr-only" id="customer-name-required">
          {t("customersFormRequired")}
        </span>
        {showNameError && nameError !== null ? (
          <p
            className="text-destructive text-xs"
            id="customer-name-error"
            role="alert"
          >
            {t(nameError)}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="customer-code">{t("customersFormCodeLabel")}</Label>
        {isEdit ? (
          <>
            <Input
              aria-describedby="customer-code-folder"
              className="font-mono"
              disabled={saving}
              id="customer-code"
              readOnly
              value={code}
            />
            <p
              className="text-muted-foreground text-xs"
              id="customer-code-folder"
            >
              {t("customersFormCodeFolder", { folderName })}
            </p>
          </>
        ) : (
          <>
            <Input
              aria-describedby={
                showCodeError
                  ? "customer-code-error customer-code-help"
                  : "customer-code-help"
              }
              aria-invalid={showCodeError}
              className="font-mono"
              disabled={saving}
              id="customer-code"
              inputMode="numeric"
              maxLength={4}
              onChange={handleCodeChange}
              placeholder={t("customersFormCodePlaceholder")}
              value={code}
            />
            {showCodeError && codeError !== null ? (
              <p
                className="text-destructive text-xs"
                id="customer-code-error"
                role="alert"
              >
                {t(codeError)}
              </p>
            ) : null}
            <p
              className="text-muted-foreground text-xs"
              id="customer-code-help"
            >
              {t("customersFormCodeHelper")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function MetadataNotice({ blocked }: { blocked: boolean }) {
  const { t } = useTranslation();

  return (
    <div
      aria-live="polite"
      className={cn(
        "flex flex-col gap-1 rounded-md border px-3 py-2 text-xs",
        blocked
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200"
      )}
      role={blocked ? "alert" : "status"}
    >
      <p className="font-medium">{t("customersFormMetadataMissingTitle")}</p>
      <p>
        {t(
          blocked
            ? "customersFormMetadataBlocked"
            : "customersFormMetadataMissingDescription"
        )}
      </p>
    </div>
  );
}

function IssueItem({ issue }: { issue: CustomerIssue }) {
  const { t } = useTranslation();
  const isError = issue.severity === "error";

  return (
    <li className="text-xs">
      <span
        className={cn(
          "inline-flex items-center gap-1 font-medium",
          isError ? "text-destructive" : "text-amber-700 dark:text-amber-300"
        )}
      >
        {isError ? (
          <CircleX aria-hidden="true" className="size-3" />
        ) : (
          <CircleAlert aria-hidden="true" className="size-3" />
        )}
        {t(CUSTOMER_ISSUE_MESSAGE_KEYS[issue.code])}
      </span>
      <TechnicalDetails message={issue.message} path={issue.path ?? null} />
    </li>
  );
}

function IssuesPanel({ issues }: { issues: CustomerIssue[] }) {
  const { t } = useTranslation();

  if (issues.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby="customer-issues-title"
      className="bg-muted/40 flex flex-col gap-2 rounded-md border p-3"
    >
      <h3
        className="flex items-center gap-1.5 text-xs font-medium"
        id="customer-issues-title"
      >
        <TriangleAlert
          aria-hidden="true"
          className="size-3.5 text-amber-600 dark:text-amber-300"
        />
        {t("customersFormIssuesTitle")}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {issues.map((issue) => (
          <IssueItem
            issue={issue}
            key={`${issue.code}:${issue.path ?? ""}:${issue.message}`}
          />
        ))}
      </ul>
    </section>
  );
}

function FormFields({
  article,
  articleErrors,
  code,
  codeError,
  folderName,
  isEdit,
  issues,
  keyLocked,
  keyLockedReason,
  metadataBlocked,
  metadataMissing,
  name,
  nameError,
  nameInputRef,
  onArticleChange,
  onCodeChange,
  onNameChange,
  onRevisionChange,
  revision,
  revisionErrors,
  saving,
  showCodeError,
  showErrors,
  showNameError,
}: FormFieldsProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-6">
      <BasicsFields
        code={code}
        codeError={codeError}
        folderName={folderName}
        isEdit={isEdit}
        name={name}
        nameError={nameError}
        nameInputRef={nameInputRef}
        onCodeChange={onCodeChange}
        onNameChange={onNameChange}
        saving={saving}
        showCodeError={showCodeError}
        showNameError={showNameError}
      />
      {metadataMissing ? <MetadataNotice blocked={metadataBlocked} /> : null}
      <IssuesPanel issues={issues} />
      <Separator />
      <SectionDefinitionEditor
        description={t("customersFormArticleDescription")}
        disabled={saving}
        errors={articleErrors}
        idPrefix="customer-article"
        keyDisabled={keyLocked}
        keyDisabledReason={keyLockedReason}
        onChange={onArticleChange}
        section={article}
        showErrors={showErrors}
        title={t("customersFormArticle")}
      />
      <Separator />
      <SectionDefinitionEditor
        description={t("customersFormRevisionDescription")}
        disabled={saving}
        errors={revisionErrors}
        idPrefix="customer-revision"
        keyDisabled={keyLocked}
        keyDisabledReason={keyLockedReason}
        onChange={onRevisionChange}
        section={revision}
        showErrors={showErrors}
        title={t("customersFormRevision")}
      />
    </div>
  );
}

function DiscardDialog({
  onConfirm,
  onOpenChange,
  open,
}: {
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const { t } = useTranslation();

  const handleConfirm = useCallback(() => {
    onConfirm();
  }, [onConfirm]);

  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("customersFormDiscardTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("customersFormDiscardDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            {t("customersFormDiscardCancel")}
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} variant="destructive">
            {t("customersFormDiscardConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function CustomerFormSheet({
  customer = null,
  mode,
  onClose,
  onSaved,
}: CustomerFormSheetProps) {
  const { t } = useTranslation();
  const isEdit = mode === "edit";
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [article, setArticle] = useState<SectionDraft>(
    createDefaultArticleDraft
  );
  const [revision, setRevision] = useState<SectionDraft>(
    createDefaultRevisionDraft
  );
  const [articleCount, setArticleCount] = useState(customer?.articleCount ?? 0);
  const [issues, setIssues] = useState<CustomerIssue[]>([]);
  const [metadataMissing, setMetadataMissing] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(() =>
    isEdit
      ? null
      : buildSnapshot({
          article: createDefaultArticleDraft(),
          code: "",
          name: "",
          revision: createDefaultRevisionDraft(),
        })
  );
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [formError, setFormError] = useState<CustomerErrorInfo | null>(null);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const folderPath = customer?.folderPath ?? null;
  const summaryArticleCount = customer?.articleCount ?? 0;

  useEffect(() => {
    if (!loading) {
      nameInputRef.current?.focus();
    }
  }, [loading]);

  useEffect(() => {
    if (validationAttempt > 0) {
      errorSummaryRef.current?.focus();
    }
  }, [validationAttempt]);

  useEffect(() => {
    if (formError !== null) {
      errorSummaryRef.current?.focus();
    }
  }, [formError]);

  useEffect(() => {
    if (!(isEdit && folderPath !== null)) {
      return;
    }

    let active = true;

    setLoading(true);
    setLoadError(null);

    getCustomer(folderPath)
      .then((detail) => {
        if (!active) {
          return;
        }

        if (!detail) {
          setLoadError(t("customersErrorNotFound"));
          setLoading(false);
          return;
        }

        const nextArticle = detail.metadataJson?.article
          ? sectionToDraft(detail.metadataJson.article)
          : createDefaultArticleDraft();
        const nextRevision = detail.metadataJson?.revision
          ? sectionToDraft(detail.metadataJson.revision)
          : createDefaultRevisionDraft();
        const nextName = detail.name ?? "";
        const nextCode = detail.customerCode;
        const metadata = detail.metadataJson;
        const metadataIncomplete =
          metadata === null ||
          metadata.article === null ||
          metadata.revision === null;

        setName(nextName);
        setCode(nextCode);
        setArticle(nextArticle);
        setRevision(nextRevision);
        setArticleCount(Math.max(detail.articleCount, summaryArticleCount));
        setIssues(metadata?.issues ?? []);
        setMetadataMissing(metadataIncomplete);
        setInitialSnapshot(
          buildSnapshot({
            article: nextArticle,
            code: nextCode,
            name: nextName,
            revision: nextRevision,
          })
        );
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        console.error(
          "Failed to load the customer:",
          toLoggableCustomerError(error)
        );
        setLoadError(t("customersErrorGeneric"));
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [folderPath, isEdit, summaryArticleCount, t]);

  const trimmedName = name.trim();
  const trimmedCode = code.trim();
  const snapshot = buildSnapshot({ article, code, name, revision });
  const {
    articleErrors,
    canSubmit,
    codeError,
    isDirty,
    keyLocked,
    metadataBlocked,
    nameError,
    revisionErrors,
    showCodeError,
    showNameError,
  } = validateForm({
    article,
    articleCount,
    code,
    initialSnapshot,
    isEdit,
    loadError,
    loading,
    metadataMissing,
    name,
    revision,
    snapshot,
    submitted,
  });
  let keyLockedReason: string | undefined;

  if (keyLocked) {
    keyLockedReason =
      articleCount === 1
        ? t("customersFormKeyLockedOne")
        : t("customersFormKeyLockedOther", { count: articleCount });
  }

  const showValidationSummary =
    formError !== null ||
    (submitted && !canSubmit && !loading && loadError === null);

  function requestClose() {
    if (saving) {
      return;
    }

    if (isDirty) {
      setConfirmDiscardOpen(true);
      return;
    }

    onClose();
  }

  function handleSheetOpenChange(open: boolean) {
    if (!open) {
      requestClose();
    }
  }

  function handleNameChange(value: string) {
    setName(value);
  }

  function handleCodeChange(value: string) {
    setCode(value.replace(/\D/gu, "").slice(0, 4));
  }

  function handleDiscardConfirm() {
    setConfirmDiscardOpen(false);
    onClose();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setFormError(null);

    if (!canSubmit) {
      setValidationAttempt((attempt) => attempt + 1);
      return;
    }

    setSaving(true);

    try {
      const articleInput = buildSectionInput(article);
      const revisionInput = buildSectionInput(revision);

      if (isEdit) {
        if (folderPath === null) {
          setLoadError(t("customersErrorNotFound"));
          return;
        }

        await updateCustomer({
          article: articleInput,
          folderPath,
          name: trimmedName,
          revision: revisionInput,
        });
      } else {
        await createCustomer({
          article: articleInput,
          name: trimmedName,
          revision: revisionInput,
          ...(trimmedCode === "" ? {} : { customerCode: trimmedCode }),
        });
      }

      onSaved(mode);
    } catch (error: unknown) {
      setFormError(describeCustomerError(error));
    } finally {
      setSaving(false);
    }
  }

  let body: ReactNode;

  if (loading) {
    body = <FormLoading />;
  } else if (loadError === null) {
    body = (
      <FormFields
        article={article}
        articleErrors={articleErrors}
        code={code}
        codeError={codeError}
        folderName={customer?.folderName ?? "—"}
        isEdit={isEdit}
        issues={issues}
        keyLocked={keyLocked}
        keyLockedReason={keyLockedReason}
        metadataBlocked={metadataBlocked}
        metadataMissing={metadataMissing}
        name={name}
        nameError={nameError}
        nameInputRef={nameInputRef}
        onArticleChange={setArticle}
        onCodeChange={handleCodeChange}
        onNameChange={handleNameChange}
        onRevisionChange={setRevision}
        revision={revision}
        revisionErrors={revisionErrors}
        saving={saving}
        showCodeError={showCodeError}
        showErrors={submitted}
        showNameError={showNameError}
      />
    );
  } else {
    body = (
      <div
        className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs"
        role="alert"
      >
        {loadError}
      </div>
    );
  }

  return (
    <Sheet onOpenChange={handleSheetOpenChange} open>
      <SheetContent
        className="w-full data-[side=right]:w-full motion-reduce:transition-none sm:max-w-2xl data-[side=right]:sm:max-w-2xl"
        showCloseButton={false}
        side="right"
      >
        <SheetHeader className="border-b p-6 pr-14">
          <SheetTitle>
            {t(isEdit ? "customersEditTitle" : "customersCreateTitle")}
          </SheetTitle>
          <SheetDescription>
            {t(
              isEdit ? "customersEditDescription" : "customersCreateDescription"
            )}
          </SheetDescription>
          <SheetClose asChild>
            <Button
              aria-label={t("customersFormClose")}
              className="absolute top-4 right-4"
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X />
            </Button>
          </SheetClose>
        </SheetHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="flex-1 overflow-y-auto p-6">
            {showValidationSummary ? (
              <ValidationSummary
                error={formError}
                summaryRef={errorSummaryRef}
              />
            ) : null}
            {body}
          </div>
          <SheetFooter className="bg-popover border-t p-4 sm:justify-end">
            <Button
              disabled={saving}
              onClick={requestClose}
              type="button"
              variant="outline"
            >
              {t("customersFormCancel")}
            </Button>
            <Button
              disabled={
                loading || saving || metadataBlocked || loadError !== null
              }
              type="submit"
            >
              {saving ? (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" />
              ) : null}
              {saving ? t("customersFormSaving") : t("customersFormSave")}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
      <DiscardDialog
        onConfirm={handleDiscardConfirm}
        onOpenChange={setConfirmDiscardOpen}
        open={confirmDiscardOpen}
      />
    </Sheet>
  );
}
