import { ORPCError, os } from "@orpc/server";
import { and, count, eq, sql } from "drizzle-orm";
import {
  type CustomerServiceContext,
  createCustomer as createCustomerService,
  removeCustomer as removeCustomerService,
  updateCustomer as updateCustomerService,
} from "@/customers/crud";
import {
  type CustomerErrorCode,
  CustomerServiceError,
} from "@/customers/errors";
import { withCustomerLock } from "@/customers/lock";
import { scanCustomers as scanCustomersService } from "@/customers/scan";
import { type CustomerRecord, deleteAllCustomerRows } from "@/customers/store";
import { getDatabase } from "@/db";
import { customers } from "@/db/schema";
import { getFoldersPreference } from "@/preferences/store";
import {
  clearCustomersOutputSchema,
  createCustomerInputSchema,
  createCustomerOutputSchema,
  customerCacheMetadataSchema,
  customerFolderPathInputSchema,
  getCustomerOutputSchema,
  listCustomersInputSchema,
  listCustomersOutputSchema,
  removeCustomerOutputSchema,
  scanCustomersInputSchema,
  scanCustomersOutputSchema,
  updateCustomerInputSchema,
  updateCustomerOutputSchema,
} from "./schemas";

// List responses only need summary columns; metadata is fetched on demand.
const customerSummaryColumns = {
  articleSchemaVersion: customers.articleSchemaVersion,
  createdAt: customers.createdAt,
  customerCode: customers.customerCode,
  folderMtimeMs: customers.folderMtimeMs,
  folderName: customers.folderName,
  folderPath: customers.folderPath,
  name: customers.name,
  revisionSchemaVersion: customers.revisionSchemaVersion,
  schemaVersion: customers.schemaVersion,
  status: customers.status,
  updatedAt: customers.updatedAt,
};

// `articleCount` lives inside the metadata document, not in its own column.
const articleCountColumn = sql<number>`coalesce(json_extract(${customers.metadataJson}, '$.articleCount'), 0)`;

const CONFLICT_ERROR_CODES: ReadonlySet<CustomerErrorCode> = new Set([
  "CUSTOMER_CODE_EXHAUSTED",
  "CUSTOMER_CODE_TAKEN",
  "CUSTOMER_HAS_ARTICLES",
  "KEY_LOCKED",
]);

const PRECONDITION_ERROR_CODES: ReadonlySet<CustomerErrorCode> = new Set([
  "ROOT_NOT_CONFIGURED",
  "ROOT_NOT_DIRECTORY",
  "ROOT_NOT_FOUND",
  "ROOT_SYMLINK",
  "TRASH_NOT_CONFIGURED",
  "TRASH_NOT_DIRECTORY",
  "TRASH_NOT_FOUND",
  "TRASH_SYMLINK",
]);

const BAD_REQUEST_ERROR_CODES: ReadonlySet<CustomerErrorCode> = new Set([
  "CONFIG_INVALID",
  "CONFIG_INVALID_JSON",
  "CONFIG_MISSING",
  "CONFIG_UNREADABLE",
  "CONFIG_UNSUPPORTED_VERSION",
  "CONFIG_VERSION_CONFLICT",
  "CUSTOMER_CODE_INVALID",
  "CUSTOMER_FOLDER_NAME_INVALID",
  "CUSTOMER_FOLDER_NOT_DIRECTORY",
  "CUSTOMER_FOLDER_SYMLINK",
  "CUSTOMER_NAME_INVALID",
  "INVALID_OPERATION",
  "KEY_RENDER_INVALID",
  "KEY_TEMPLATE_INVALID",
]);

/**
 * Translates a domain error into the oRPC status the renderer expects.
 *
 * `READ_FAILED`, `WRITE_FAILED` and `TRASH_MOVE_FAILED` are deliberately not
 * mapped: they are unexpected and must keep their original class so the
 * interceptor logs them as real 5xx failures.
 */
function mapCustomerError(error: unknown): never {
  if (error instanceof CustomerServiceError) {
    if (error.code === "CUSTOMER_NOT_FOUND") {
      throw new ORPCError("NOT_FOUND", { message: error.message });
    }

    if (CONFLICT_ERROR_CODES.has(error.code)) {
      throw new ORPCError("CONFLICT", { message: error.message });
    }

    if (PRECONDITION_ERROR_CODES.has(error.code)) {
      throw new ORPCError("PRECONDITION_FAILED", { message: error.message });
    }

    if (BAD_REQUEST_ERROR_CODES.has(error.code)) {
      throw new ORPCError("BAD_REQUEST", { message: error.message });
    }
  }

  throw error;
}

function customerServiceContext(): CustomerServiceContext {
  const folders = getFoldersPreference();

  return {
    articlesDirectory: folders.articlesDirectory,
    db: getDatabase(),
    trashDirectory: folders.trashDirectory,
  };
}

/**
 * Adds the derived `articleCount` and normalises the cached metadata so the
 * result satisfies the wire schema. Legacy rows may still hold an arbitrary
 * metadata document; normalising it here keeps the caller working instead of
 * failing the whole response.
 */
function customerOutput(record: CustomerRecord) {
  const metadata = customerCacheMetadataSchema.safeParse(record.metadataJson);

  return {
    ...record,
    articleCount: metadata.success ? metadata.data.articleCount : 0,
    metadataJson: metadata.success ? metadata.data : null,
  };
}

export const listCustomers = os
  .input(listCustomersInputSchema)
  .output(listCustomersOutputSchema)
  .handler(({ input }) => {
    const db = getDatabase();
    const searchTerm = input.search?.normalize("NFC").toLocaleLowerCase();

    const where = and(
      input.status ? eq(customers.status, input.status) : undefined,
      searchTerm
        ? sql`instr(${customers.searchText}, ${searchTerm}) > 0`
        : undefined
    );

    const rows = db
      .select({
        ...customerSummaryColumns,
        articleCount: articleCountColumn,
        // Window function: one scan returns the page and the full total.
        total: sql<number>`count(*) over ()`,
      })
      .from(customers)
      .where(where)
      .orderBy(
        customers.customerCode,
        customers.folderName,
        customers.folderPath
      )
      .limit(input.limit)
      .offset(input.offset)
      .all();

    // `count(*) over ()` yields no rows when the offset is past the end, so the
    // total is only fetched separately for an empty page.
    const total =
      rows[0]?.total ??
      db.select({ total: count() }).from(customers).where(where).all()[0]
        ?.total ??
      0;

    const items = rows.map(({ articleCount, total: _total, ...item }) => {
      const articleCountValue = Number(articleCount);

      // Legacy or hand-edited metadata can contain a non-integer count; never
      // let one bad row fail the whole list response.
      return {
        ...item,
        articleCount:
          Number.isInteger(articleCountValue) && articleCountValue >= 0
            ? articleCountValue
            : 0,
      };
    });

    return { items, total };
  });

// Lookups return `null` when the row does not exist; mutations throw NOT_FOUND.
export const getCustomer = os
  .input(customerFolderPathInputSchema)
  .output(getCustomerOutputSchema)
  .handler(({ input }) => {
    const db = getDatabase();
    const row =
      db
        .select()
        .from(customers)
        .where(eq(customers.folderPath, input.folderPath))
        .get() ?? null;

    if (!row) {
      return null;
    }

    return customerOutput(row);
  });

export const scanCustomers = os
  .input(scanCustomersInputSchema)
  .output(scanCustomersOutputSchema)
  .handler(async () => {
    try {
      const { articlesDirectory } = getFoldersPreference();

      return await scanCustomersService({
        db: getDatabase(),
        rootDirectory: articlesDirectory,
      });
    } catch (error) {
      throw mapCustomerError(error);
    }
  });

export const createCustomer = os
  .input(createCustomerInputSchema)
  .output(createCustomerOutputSchema)
  .handler(async ({ input }) => {
    try {
      const customer = await createCustomerService(
        customerServiceContext(),
        input
      );

      return customerOutput(customer);
    } catch (error) {
      throw mapCustomerError(error);
    }
  });

export const updateCustomer = os
  .input(updateCustomerInputSchema)
  .output(updateCustomerOutputSchema)
  .handler(async ({ input }) => {
    try {
      const customer = await updateCustomerService(
        customerServiceContext(),
        input
      );

      return customerOutput(customer);
    } catch (error) {
      throw mapCustomerError(error);
    }
  });

export const removeCustomer = os
  .input(customerFolderPathInputSchema)
  .output(removeCustomerOutputSchema)
  .handler(async ({ input }) => {
    try {
      return await removeCustomerService(customerServiceContext(), input);
    } catch (error) {
      throw mapCustomerError(error);
    }
  });

// Cache-only reset: the filesystem is the source of truth and is never touched.
// It shares the customer lock so a clear cannot interleave with a scan that is
// repopulating the cache.
export const clearCustomers = os
  .output(clearCustomersOutputSchema)
  .handler(() =>
    withCustomerLock(async () => deleteAllCustomerRows(getDatabase()))
  );
