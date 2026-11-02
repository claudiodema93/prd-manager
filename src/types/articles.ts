import type { z } from "zod";
import type {
  createArticleInputSchema,
  listArticlesInputSchema,
  scanArticlesInputSchema,
  updateArticleInputSchema,
} from "@/ipc/articles/schemas";

export type CreateArticleInput = z.input<typeof createArticleInputSchema>;
export type UpdateArticleInput = z.input<typeof updateArticleInputSchema>;
export type ListArticlesInput = z.input<typeof listArticlesInputSchema>;
export type ScanArticlesInput = z.input<typeof scanArticlesInputSchema>;

export type {
  ArticleCacheMetadata,
  ArticleCustomValue,
  ArticleIssue,
  ArticleScanResult,
} from "@/articles/types";
