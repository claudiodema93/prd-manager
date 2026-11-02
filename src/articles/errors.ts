/**
 * Error codes shared by the article scanner and CRUD service. The IPC layer
 * maps these to oRPC statuses without leaking implementation details.
 */
export const ARTICLE_ERROR_CODES = [
  "ARTICLE_ALREADY_EXISTS",
  "ARTICLE_CUSTOMER_CONFIG_INVALID",
  "ARTICLE_CUSTOMER_CONFIG_MISSING",
  "ARTICLE_CUSTOMER_NOT_DIRECTORY",
  "ARTICLE_CUSTOMER_NOT_FOUND",
  "ARTICLE_CUSTOMER_SYMLINK",
  "ARTICLE_DATA_INVALID",
  "ARTICLE_DATA_INVALID_JSON",
  "ARTICLE_DATA_MISSING",
  "ARTICLE_DATA_UNREADABLE",
  "ARTICLE_FOLDER_NAME_INVALID",
  "ARTICLE_FOLDER_NOT_DIRECTORY",
  "ARTICLE_FOLDER_SYMLINK",
  "ARTICLE_KEY_LOCKED",
  "ARTICLE_NOT_FOUND",
  "ARTICLE_PATH_INVALID",
  "INVALID_OPERATION",
  "KEY_RENDER_INVALID",
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

export type ArticleErrorCode = (typeof ARTICLE_ERROR_CODES)[number];

export class ArticleServiceError extends Error {
  readonly code: ArticleErrorCode;

  constructor(
    code: ArticleErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "ArticleServiceError";
    this.code = code;
  }
}
