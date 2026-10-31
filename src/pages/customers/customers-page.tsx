import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  FolderOpen,
  LoaderCircle,
  type LucideIcon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SearchX,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import type { ChangeEvent, ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listCustomers, scanCustomers } from "@/actions/customers";
import { getFolderPreferences } from "@/actions/folders";
import { Badge } from "@/components/ui/badge";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CustomerStatus } from "@/constants/customers";
import type { TranslationKey } from "@/localization/resources/it";
import type { ListCustomersInput } from "@/types/customers";
import type { FolderPreferences } from "@/types/preferences";
import CustomerDeleteDialog from "./customer-delete-dialog";
import {
  CUSTOMER_ERROR_MESSAGE_KEYS,
  CUSTOMER_ISSUE_MESSAGE_KEYS,
  describeCustomerError,
  toLoggableCustomerError,
} from "./customer-errors";
import CustomerFormSheet from "./customer-form-sheet";
import CustomerStatusBadge from "./customer-status-badge";
import type { CustomerIssue, CustomerSummary } from "./customer-types";
import TechnicalDetails from "./technical-details";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;
const SKELETON_ROWS = ["one", "two", "three", "four", "five"];

type StatusFilter = "all" | CustomerStatus;
type SheetState =
  | { mode: "create" }
  | { mode: "edit"; customer: CustomerSummary }
  | null;
type NoticeTone = "error" | "success" | "warning";

interface Notice {
  message: string;
  tone: NoticeTone;
}

interface CustomerListSectionProps {
  items: CustomerSummary[];
  listError: string | null;
  listLoading: boolean;
  offset: number;
  onClearFilters: () => void;
  onCreate: () => void;
  onDeleteCustomer: (customer: CustomerSummary) => void;
  onEditCustomer: (customer: CustomerSummary) => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onRetry: () => void;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  search: string;
  searchInput: string;
  status: StatusFilter;
  total: number;
}

interface CustomersContentProps extends CustomerListSectionProps {
  folders: FolderPreferences | null;
  foldersError: string | null;
}

const STATUS_OPTIONS: { labelKey: TranslationKey; value: StatusFilter }[] = [
  { labelKey: "customersStatusAll", value: "all" },
  { labelKey: "customersStatusOk", value: "ok" },
  { labelKey: "customersStatusWarning", value: "warning" },
  { labelKey: "customersStatusError", value: "error" },
];

const NOTICE_STYLES: Record<NoticeTone, string> = {
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  success:
    "border-emerald-600/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  warning:
    "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
};

const NOTICE_ICONS: Record<NoticeTone, LucideIcon> = {
  error: CircleX,
  success: CircleCheck,
  warning: TriangleAlert,
};

const INVALID_DATE_FALLBACK = "—";

function toDateTimeAttribute(timestamp: number): string | undefined {
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }

  const date = new Date(timestamp);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function formatUpdatedAt(timestamp: number, language: string): string {
  if (!Number.isFinite(timestamp)) {
    return INVALID_DATE_FALLBACK;
  }

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return INVALID_DATE_FALLBACK;
  }

  try {
    return new Intl.DateTimeFormat(language, {
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  } catch {
    return INVALID_DATE_FALLBACK;
  }
}

function EmptyState({
  children,
  description,
  Icon,
  title,
}: {
  children: ReactNode;
  description: string;
  Icon: LucideIcon;
  title: string;
}) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-10 text-center">
      <Icon aria-hidden="true" className="text-muted-foreground size-8" />
      <div className="flex max-w-md flex-col gap-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {children}
      </div>
    </section>
  );
}

function LoadingTable() {
  const { t } = useTranslation();

  return (
    <section
      aria-busy="true"
      className="flex flex-col gap-3 rounded-lg border p-3"
    >
      <span className="sr-only">{t("customersLoading")}</span>
      {SKELETON_ROWS.map((row) => (
        <div className="flex items-center gap-3" key={row}>
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </section>
  );
}

function ErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className="border-destructive/40 bg-destructive/10 text-destructive flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
      role="alert"
    >
      <div className="flex min-w-0 items-center gap-2">
        <CircleX aria-hidden="true" className="size-3.5 shrink-0" />
        <p className="break-words">{message}</p>
      </div>
      <Button onClick={onRetry} size="sm" type="button" variant="outline">
        {t("customersRetry")}
      </Button>
    </div>
  );
}

function StatusNotice({
  notice,
  onDismiss,
}: {
  notice: Notice;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const Icon = NOTICE_ICONS[notice.tone];

  return (
    <div
      aria-live="polite"
      className={cn(
        "flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-xs",
        NOTICE_STYLES[notice.tone]
      )}
      role="status"
    >
      <div className="flex min-w-0 items-start gap-2">
        <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <p className="break-words">{notice.message}</p>
      </div>
      <Button
        aria-label={t("customersDismiss")}
        onClick={onDismiss}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <X />
      </Button>
    </div>
  );
}

function ScanIssueItem({ issue }: { issue: CustomerIssue }) {
  const { t } = useTranslation();

  return (
    <li className="break-words">
      <span
        className={cn(
          issue.severity === "error" ? "text-destructive" : undefined
        )}
      >
        {t(CUSTOMER_ISSUE_MESSAGE_KEYS[issue.code])}
      </span>
      <TechnicalDetails message={issue.message} path={issue.path ?? null} />
    </li>
  );
}

const VISIBLE_SCAN_ISSUES = 3;

function ScanIssuesNotice({
  issues,
  onDismiss,
}: {
  issues: CustomerIssue[];
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const hasErrors = issues.some((issue) => issue.severity === "error");
  const visibleIssues = issues.slice(0, VISIBLE_SCAN_ISSUES);
  const remainingIssues = issues.slice(VISIBLE_SCAN_ISSUES);
  const Icon = hasErrors ? CircleX : TriangleAlert;

  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-xs",
        hasErrors ? NOTICE_STYLES.error : NOTICE_STYLES.warning
      )}
      role="alert"
    >
      <div className="flex min-w-0 items-start gap-2">
        <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium">
            {t("customersScanIssuesTitle")} ({issues.length})
          </p>
          <ul className="flex flex-col gap-1">
            {visibleIssues.map((issue) => (
              <ScanIssueItem
                issue={issue}
                key={`${issue.code}:${issue.path ?? ""}:${issue.message}`}
              />
            ))}
          </ul>
          {remainingIssues.length > 0 ? (
            <details>
              <summary className="cursor-pointer select-none">
                {t("customersScanIssuesMore", {
                  remaining: remainingIssues.length,
                })}
              </summary>
              <ul className="mt-1 flex flex-col gap-1">
                {remainingIssues.map((issue) => (
                  <ScanIssueItem
                    issue={issue}
                    key={`${issue.code}:${issue.path ?? ""}:${issue.message}`}
                  />
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
      <Button
        aria-label={t("customersDismiss")}
        onClick={onDismiss}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <X />
      </Button>
    </div>
  );
}

function CustomerTableRow({
  customer,
  onDelete,
  onEdit,
}: {
  customer: CustomerSummary;
  onDelete: (customer: CustomerSummary) => void;
  onEdit: (customer: CustomerSummary) => void;
}) {
  const { i18n, t } = useTranslation();
  const displayName = customer.name ?? customer.customerCode;
  const deleteDisabled = customer.articleCount > 0;

  const handleEdit = useCallback(() => {
    onEdit(customer);
  }, [onEdit, customer]);

  const handleDelete = useCallback(() => {
    if (deleteDisabled) {
      return;
    }

    onDelete(customer);
  }, [deleteDisabled, onDelete, customer]);

  return (
    <TableRow>
      <TableCell className="w-16 truncate pl-3 font-mono">
        {customer.customerCode}
      </TableCell>
      <TableCell>
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{displayName}</span>
          <span className="text-muted-foreground truncate text-[0.625rem]">
            {customer.folderName}
          </span>
          <span className="text-muted-foreground text-[0.625rem] md:hidden">
            {t("customersColumnArticles")}: {customer.articleCount}
          </span>
        </div>
      </TableCell>
      <TableCell className="hidden w-16 md:table-cell">
        <Badge variant="secondary">
          <span className="sr-only">{t("customersColumnArticles")}: </span>
          {customer.articleCount}
        </Badge>
      </TableCell>
      <TableCell className="w-28">
        <CustomerStatusBadge status={customer.status} />
      </TableCell>
      <TableCell className="text-muted-foreground hidden w-32 lg:table-cell">
        <time dateTime={toDateTimeAttribute(customer.updatedAt)}>
          {formatUpdatedAt(customer.updatedAt, i18n.language)}
        </time>
      </TableCell>
      <TableCell className="w-20 pr-3">
        <div className="flex items-center justify-end gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t("customersEditCustomer", {
                  name: displayName,
                })}
                onClick={handleEdit}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Pencil />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("customersEdit")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-disabled={deleteDisabled}
                aria-label={
                  deleteDisabled
                    ? t("customersDeleteBlockedTooltip", {
                        count: customer.articleCount,
                      })
                    : t("customersDeleteCustomer", {
                        name: displayName,
                      })
                }
                className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                onClick={handleDelete}
                size="icon"
                type="button"
                variant="destructive"
              >
                <Trash2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {deleteDisabled
                ? t("customersDeleteBlockedTooltip", {
                    count: customer.articleCount,
                  })
                : t("customersDelete")}
            </TooltipContent>
          </Tooltip>
        </div>
      </TableCell>
    </TableRow>
  );
}

function CustomersTable({
  items,
  listLoading,
  offset,
  onDeleteCustomer,
  onEditCustomer,
  onNextPage,
  onPreviousPage,
  total,
}: {
  items: CustomerSummary[];
  listLoading: boolean;
  offset: number;
  onDeleteCustomer: (customer: CustomerSummary) => void;
  onEditCustomer: (customer: CustomerSummary) => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
  total: number;
}) {
  const { t } = useTranslation();

  return (
    <section
      aria-busy={listLoading}
      className="flex min-h-0 flex-col rounded-lg border"
    >
      <Table className="table-fixed">
        <TableCaption className="sr-only">
          {t("customersTableCaption")}
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16 pl-3" scope="col">
              {t("customersColumnCode")}
            </TableHead>
            <TableHead scope="col">{t("customersColumnCustomer")}</TableHead>
            <TableHead className="hidden w-16 md:table-cell" scope="col">
              {t("customersColumnArticles")}
            </TableHead>
            <TableHead className="w-28" scope="col">
              {t("customersColumnStatus")}
            </TableHead>
            <TableHead className="hidden w-32 lg:table-cell" scope="col">
              {t("customersColumnUpdated")}
            </TableHead>
            <TableHead className="w-20 pr-3 text-right" scope="col">
              {t("customersColumnActions")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((customer) => (
            <CustomerTableRow
              customer={customer}
              key={customer.folderPath}
              onDelete={onDeleteCustomer}
              onEdit={onEditCustomer}
            />
          ))}
        </TableBody>
      </Table>
      {total > 0 ? (
        <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
          <p className="text-muted-foreground text-xs">
            {t("customersRange", {
              from: offset + 1,
              to: Math.min(offset + PAGE_SIZE, total),
              total,
            })}
          </p>
          <div className="flex items-center gap-1">
            <Button
              aria-label={t("customersPreviousPage")}
              disabled={offset === 0 || listLoading}
              onClick={onPreviousPage}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <ChevronLeft />
            </Button>
            <Button
              aria-label={t("customersNextPage")}
              disabled={offset + PAGE_SIZE >= total || listLoading}
              onClick={onNextPage}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function CustomersToolbar({
  listLoading,
  onSearchChange,
  onStatusChange,
  searchInput,
  status,
}: {
  listLoading: boolean;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  searchInput: string;
  status: StatusFilter;
}) {
  const { t } = useTranslation();

  const handleSearchChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onSearchChange(event.target.value);
    },
    [onSearchChange]
  );

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor="customers-search">{t("customersSearchLabel")}</Label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1.5 left-2 size-3.5"
          />
          <Input
            className="pl-7"
            id="customers-search"
            maxLength={256}
            onChange={handleSearchChange}
            placeholder={t("customersSearchPlaceholder")}
            type="text"
            value={searchInput}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="customers-status">
          {t("customersStatusFilterLabel")}
        </Label>
        <Select onValueChange={onStatusChange} value={status}>
          <SelectTrigger
            aria-label={t("customersStatusFilterLabel")}
            className="w-full sm:w-36"
            id="customers-status"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {listLoading ? (
        <span
          className="text-muted-foreground flex items-center gap-1 text-xs sm:pb-1.5"
          role="status"
        >
          <LoaderCircle
            aria-hidden="true"
            className="size-3.5 animate-spin motion-reduce:animate-none"
          />
          <span className="sr-only">{t("customersLoading")}</span>
        </span>
      ) : null}
    </div>
  );
}

function EmptyList({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation();

  return (
    <EmptyState
      description={t("customersEmptyDescription")}
      Icon={FolderOpen}
      title={t("customersEmptyTitle")}
    >
      <Button onClick={onCreate} size="sm" type="button">
        <Plus />
        {t("customersNew")}
      </Button>
    </EmptyState>
  );
}

function FilteredEmpty({ onClear }: { onClear: () => void }) {
  const { t } = useTranslation();

  return (
    <EmptyState
      description={t("customersFiltersEmptyDescription")}
      Icon={SearchX}
      title={t("customersFiltersEmptyTitle")}
    >
      <Button onClick={onClear} size="sm" type="button" variant="outline">
        {t("customersClearFilters")}
      </Button>
    </EmptyState>
  );
}

function CustomerListSection({
  items,
  listError,
  listLoading,
  offset,
  onClearFilters,
  onCreate,
  onDeleteCustomer,
  onEditCustomer,
  onNextPage,
  onPreviousPage,
  onRetry,
  onSearchChange,
  onStatusChange,
  search,
  searchInput,
  status,
  total,
}: CustomerListSectionProps) {
  const showToolbar =
    total > 0 || listLoading || searchInput.trim() !== "" || status !== "all";
  const filtersActive = search !== "" || status !== "all";
  let content: ReactNode;

  if (listError !== null) {
    content = <ErrorPanel message={listError} onRetry={onRetry} />;
  } else if (
    (listLoading && items.length === 0) ||
    (items.length === 0 && total > 0)
  ) {
    content = <LoadingTable />;
  } else if (total === 0 && filtersActive) {
    content = <FilteredEmpty onClear={onClearFilters} />;
  } else if (total === 0) {
    content = <EmptyList onCreate={onCreate} />;
  } else {
    content = (
      <CustomersTable
        items={items}
        listLoading={listLoading}
        offset={offset}
        onDeleteCustomer={onDeleteCustomer}
        onEditCustomer={onEditCustomer}
        onNextPage={onNextPage}
        onPreviousPage={onPreviousPage}
        total={total}
      />
    );
  }

  return (
    <>
      {showToolbar ? (
        <CustomersToolbar
          listLoading={listLoading}
          onSearchChange={onSearchChange}
          onStatusChange={onStatusChange}
          searchInput={searchInput}
          status={status}
        />
      ) : null}
      {content}
    </>
  );
}

function CustomersContent({
  folders,
  foldersError,
  ...listProps
}: CustomersContentProps) {
  const { t } = useTranslation();

  if (foldersError !== null) {
    return <ErrorPanel message={foldersError} onRetry={listProps.onRetry} />;
  }

  if (folders === null) {
    return <LoadingTable />;
  }

  if (folders.articlesDirectory === null) {
    return (
      <EmptyState
        description={t("customersNoRootDescription")}
        Icon={FolderOpen}
        title={t("customersNoRootTitle")}
      >
        <Button asChild size="sm">
          <Link to="/settings/folders">{t("customersOpenFolders")}</Link>
        </Button>
      </EmptyState>
    );
  }

  return <CustomerListSection {...listProps} />;
}

export default function CustomersPage() {
  const { t } = useTranslation();
  const [folders, setFolders] = useState<FolderPreferences | null>(null);
  const [foldersError, setFoldersError] = useState<string | null>(null);
  const [foldersToken, setFoldersToken] = useState(0);
  const [items, setItems] = useState<CustomerSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [scanIssues, setScanIssues] = useState<CustomerIssue[]>([]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomerSummary | null>(
    null
  );
  const articlesDirectory = folders?.articlesDirectory ?? null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: foldersToken is a manual refresh trigger consumed only by the dependency array
  useEffect(() => {
    let active = true;

    setFolders(null);
    setFoldersError(null);

    getFolderPreferences()
      .then((preferences) => {
        if (active) {
          setFolders(preferences);
        }
      })
      .catch((error: unknown) => {
        console.error(
          "Failed to load the folder preferences:",
          toLoggableCustomerError(error)
        );

        if (active) {
          setFoldersError(t("customersFoldersLoadError"));
        }
      });

    return () => {
      active = false;
    };
  }, [foldersToken, t]);

  useEffect(() => {
    const trimmed = searchInput.trim();

    if (trimmed === search) {
      return;
    }

    const timer = setTimeout(() => {
      setSearch(trimmed);
      setOffset(0);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [search, searchInput]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken is a manual refresh trigger consumed only by the dependency array
  useEffect(() => {
    if (articlesDirectory === null) {
      setItems([]);
      setTotal(0);
      setListLoading(false);
      setListError(null);
      return;
    }

    let active = true;
    const input: ListCustomersInput = {
      limit: PAGE_SIZE,
      offset,
      ...(search === "" ? {} : { search }),
      ...(status === "all" ? {} : { status }),
    };

    setListLoading(true);
    setListError(null);

    listCustomers(input)
      .then((page) => {
        if (!active) {
          return;
        }

        setItems(page.items);
        setTotal(page.total);
        setListLoading(false);

        if (page.items.length === 0 && page.total > 0 && offset > 0) {
          setOffset(0);
        }
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        console.error(
          "Failed to load the customers:",
          toLoggableCustomerError(error)
        );
        setListError(t("customersLoadError"));
        setListLoading(false);
      });

    return () => {
      active = false;
    };
  }, [articlesDirectory, offset, reloadToken, search, status, t]);

  function reload() {
    setReloadToken((token) => token + 1);
  }

  function handleRetry() {
    if (foldersError !== null) {
      setFoldersToken((token) => token + 1);
    }

    reload();
  }

  function handleStatusChange(value: string) {
    if (
      value === "all" ||
      value === "ok" ||
      value === "warning" ||
      value === "error"
    ) {
      setStatus(value);
      setOffset(0);
    }
  }

  function handleClearFilters() {
    setSearchInput("");
    setSearch("");
    setStatus("all");
    setOffset(0);
  }

  function handleCreate() {
    setSheet({ mode: "create" });
  }

  function handleEditCustomer(customer: CustomerSummary) {
    setSheet({ customer, mode: "edit" });
  }

  function handleDeleteCustomer(customer: CustomerSummary) {
    setDeleteTarget(customer);
  }

  function handleCloseSheet() {
    setSheet(null);
  }

  function handleCloseDelete() {
    setDeleteTarget(null);
  }

  function handlePreviousPage() {
    setOffset((current) => Math.max(0, current - PAGE_SIZE));
  }

  function handleNextPage() {
    setOffset((current) => current + PAGE_SIZE);
  }

  function handleDismissNotice() {
    setNotice(null);
  }

  function handleDismissScanIssues() {
    setScanIssues([]);
  }

  async function handleScan() {
    if (articlesDirectory === null) {
      return;
    }

    setScanning(true);
    setNotice(null);
    setScanIssues([]);

    try {
      const result = await scanCustomers();
      const hasErrors = result.issues.some(
        (issue) => issue.severity === "error"
      );

      if (result.root === null || hasErrors) {
        setNotice({
          message: t("customersScanIncomplete", {
            scanned: result.scanned,
          }),
          tone: "error",
        });
      } else {
        setNotice({
          message: t("customersScanSummary", {
            created: result.created,
            removed: result.removed,
            scanned: result.scanned,
            unchanged: result.unchanged,
            updated: result.updated,
          }),
          tone: "success",
        });
      }

      setScanIssues(result.issues);
      reload();
    } catch (error: unknown) {
      console.error(
        "Failed to scan the customers folder:",
        toLoggableCustomerError(error)
      );
      setNotice({
        message: t(
          CUSTOMER_ERROR_MESSAGE_KEYS[describeCustomerError(error).kind]
        ),
        tone: "error",
      });
    } finally {
      setScanning(false);
    }
  }

  function handleSaved(savedMode: "create" | "edit") {
    setSheet(null);
    setNotice({
      message: t(
        savedMode === "create"
          ? "customersCreateSuccess"
          : "customersUpdateSuccess"
      ),
      tone: "success",
    });
    setOffset(0);
    reload();
  }

  function handleDeleted() {
    setDeleteTarget(null);
    setNotice({ message: t("customersDeleteSuccess"), tone: "success" });
    setOffset(0);
    reload();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold tracking-tight">
            {t("customersTitle")}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t("customersDescription")}
          </p>
        </div>
        {articlesDirectory === null ? null : (
          <div className="flex items-center gap-2">
            <Button
              aria-busy={scanning}
              disabled={scanning}
              onClick={handleScan}
              size="sm"
              type="button"
              variant="outline"
            >
              <RefreshCw
                className={cn(
                  scanning && "animate-spin motion-reduce:animate-none"
                )}
              />
              {scanning
                ? t("customersRefreshScanning")
                : t("customersScanFolder")}
            </Button>
            <Button onClick={handleCreate} size="sm" type="button">
              <Plus />
              {t("customersNew")}
            </Button>
          </div>
        )}
      </header>

      {notice ? (
        <StatusNotice notice={notice} onDismiss={handleDismissNotice} />
      ) : null}
      {scanIssues.length > 0 ? (
        <ScanIssuesNotice
          issues={scanIssues}
          onDismiss={handleDismissScanIssues}
        />
      ) : null}

      <CustomersContent
        folders={folders}
        foldersError={foldersError}
        items={items}
        listError={listError}
        listLoading={listLoading}
        offset={offset}
        onClearFilters={handleClearFilters}
        onCreate={handleCreate}
        onDeleteCustomer={handleDeleteCustomer}
        onEditCustomer={handleEditCustomer}
        onNextPage={handleNextPage}
        onPreviousPage={handlePreviousPage}
        onRetry={handleRetry}
        onSearchChange={setSearchInput}
        onStatusChange={handleStatusChange}
        search={search}
        searchInput={searchInput}
        status={status}
        total={total}
      />

      {sheet ? (
        <CustomerFormSheet
          customer={sheet.mode === "edit" ? sheet.customer : null}
          key={sheet.mode === "edit" ? sheet.customer.folderPath : "create"}
          mode={sheet.mode}
          onClose={handleCloseSheet}
          onSaved={handleSaved}
        />
      ) : null}
      {deleteTarget ? (
        <CustomerDeleteDialog
          customer={deleteTarget}
          onClose={handleCloseDelete}
          onDeleted={handleDeleted}
          trashDirectory={folders?.trashDirectory ?? null}
        />
      ) : null}
    </div>
  );
}
