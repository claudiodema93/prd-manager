import { ORPCError } from "@orpc/client";
import type { TranslationKey } from "@/localization/resources/it";
import type { CustomerIssue } from "./customer-types";

export type CustomerErrorKind =
  | "badRequest"
  | "conflict"
  | "generic"
  | "notFound"
  | "precondition";

export interface CustomerErrorInfo {
  /** The oRPC code, when the failure came from the RPC layer. */
  code: string | null;
  /** The backend message, when available. It may be technical. */
  detail: string | null;
  kind: CustomerErrorKind;
}

export interface LoggableCustomerError {
  code: string | null;
  message: string | null;
  name: string | null;
}

export const CUSTOMER_ERROR_MESSAGE_KEYS: Record<
  CustomerErrorKind,
  TranslationKey
> = {
  badRequest: "customersErrorBadRequest",
  conflict: "customersErrorConflict",
  generic: "customersErrorGeneric",
  notFound: "customersErrorNotFound",
  precondition: "customersErrorPrecondition",
};

export const CUSTOMER_ISSUE_MESSAGE_KEYS: Record<
  CustomerIssue["code"],
  TranslationKey
> = {
  ARTICLE_INVALID: "customersIssueArticleInvalid",
  ARTICLE_SYMLINK: "customersIssueArticleSymlink",
  CONFIG_INVALID: "customersIssueConfigInvalid",
  CONFIG_INVALID_JSON: "customersIssueConfigInvalidJson",
  CONFIG_MISSING: "customersIssueConfigMissing",
  CONFIG_UNREADABLE: "customersIssueConfigUnreadable",
  ENTRY_UNEXPECTED: "customersIssueEntryUnexpected",
  FOLDER_NOT_DIRECTORY: "customersIssueFolderNotDirectory",
  FOLDER_SYMLINK: "customersIssueFolderSymlink",
  FOLDER_UNREADABLE: "customersIssueFolderUnreadable",
  ROOT_MISSING: "customersIssueRootMissing",
  ROOT_NOT_DIRECTORY: "customersIssueRootNotDirectory",
  ROOT_SYMLINK: "customersIssueRootSymlink",
  ROOT_UNREADABLE: "customersIssueRootUnreadable",
};

function readErrorCode(error: unknown): string | null {
  if (error instanceof ORPCError) {
    return error.code;
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { code?: unknown };

    return typeof code === "string" ? code : null;
  }

  return null;
}

function readErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    const message = error.message.trim();

    return message === "" ? null : message;
  }

  return null;
}

/**
 * Only the non-sensitive bits of an error reach the renderer console: never
 * the whole oRPC error object (which can carry the request payload).
 */
export function toLoggableCustomerError(error: unknown): LoggableCustomerError {
  return {
    code: readErrorCode(error),
    message: readErrorMessage(error),
    name: error instanceof Error ? error.name : null,
  };
}

/**
 * Maps an RPC failure to a user-facing category. The backend remains the
 * authority: we only translate its status codes, and keep the message as an
 * optional technical detail.
 */
export function describeCustomerError(error: unknown): CustomerErrorInfo {
  const code = readErrorCode(error);
  const detail = readErrorMessage(error);

  switch (code) {
    case "NOT_FOUND":
      return { code, detail, kind: "notFound" };
    case "CONFLICT":
      return { code, detail, kind: "conflict" };
    case "PRECONDITION_FAILED":
      return { code, detail, kind: "precondition" };
    case "BAD_REQUEST":
      return { code, detail, kind: "badRequest" };
    default:
      return { code, detail, kind: "generic" };
  }
}
