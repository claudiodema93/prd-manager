import { ipc } from "@/ipc/manager";
import type {
  CreateArticleInput,
  ListArticlesInput,
  UpdateArticleInput,
} from "@/types/articles";

export type {
  CreateArticleInput,
  ListArticlesInput,
  UpdateArticleInput,
} from "@/types/articles";

export function listArticles(input: ListArticlesInput) {
  return ipc.client.articles.listArticles(input);
}

export function getArticle(folderPath: string) {
  return ipc.client.articles.getArticle({ folderPath });
}

export function createArticle(input: CreateArticleInput) {
  return ipc.client.articles.createArticle(input);
}

export function updateArticle(input: UpdateArticleInput) {
  return ipc.client.articles.updateArticle(input);
}

export function removeArticle(folderPath: string) {
  return ipc.client.articles.removeArticle({ folderPath });
}

export function scanArticles() {
  return ipc.client.articles.scanArticles({});
}

export function clearArticles() {
  return ipc.client.articles.clearArticles();
}
