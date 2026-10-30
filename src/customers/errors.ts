/**
 * Error codes shared by the customer scanner and CRUD service. The IPC layer
 * maps these to oRPC statuses without leaking implementation details.
 */
export const CUSTOMER_ERROR_CODES = [
  "CUSTOMER_CODE_EXHAUSTED",
  "CUSTOMER_CODE_INVALID",
  "CUSTOMER_CODE_TAKEN",
  "CUSTOMER_FOLDER_NAME_INVALID",
  "CUSTOMER_FOLDER_NOT_DIRECTORY",
  "CUSTOMER_FOLDER_SYMLINK",
  "CUSTOMER_HAS_ARTICLES",
  "CUSTOMER_NAME_INVALID",
  "CUSTOMER_NOT_FOUND",
  "CONFIG_INVALID",
  "CONFIG_INVALID_JSON",
  "CONFIG_MISSING",
  "CONFIG_UNREADABLE",
  "CONFIG_UNSUPPORTED_VERSION",
  "CONFIG_VERSION_CONFLICT",
  "INVALID_OPERATION",
  "KEY_LOCKED",
  "KEY_RENDER_INVALID",
  "KEY_TEMPLATE_INVALID",
  "READ_FAILED",
  "ROOT_NOT_CONFIGURED",
  "ROOT_NOT_DIRECTORY",
  "ROOT_NOT_FOUND",
  "ROOT_SYMLINK",
  "TRASH_MOVE_FAILED",
  "TRASH_NOT_CONFIGURED",
  "TRASH_NOT_DIRECTORY",
  "TRASH_NOT_FOUND",
  "TRASH_SYMLINK",
  "WRITE_FAILED",
] as const;

export type CustomerErrorCode = (typeof CUSTOMER_ERROR_CODES)[number];

export class CustomerServiceError extends Error {
  readonly code: CustomerErrorCode;

  constructor(
    code: CustomerErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "CustomerServiceError";
    this.code = code;
  }
}
