import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearArticles,
  createArticle,
  getArticle,
  listArticles,
  removeArticle,
  scanArticles,
  updateArticle,
} from "@/actions/articles";
import type {
  CreateArticleInput,
  ListArticlesInput,
  UpdateArticleInput,
} from "@/types/articles";

const {
  clearArticlesMock,
  createArticleMock,
  getArticleMock,
  listArticlesMock,
  removeArticleMock,
  scanArticlesMock,
  updateArticleMock,
} = vi.hoisted(() => ({
  clearArticlesMock: vi.fn(),
  createArticleMock: vi.fn(),
  getArticleMock: vi.fn(),
  listArticlesMock: vi.fn(),
  removeArticleMock: vi.fn(),
  scanArticlesMock: vi.fn(),
  updateArticleMock: vi.fn(),
}));

vi.mock("@/ipc/manager", () => ({
  ipc: {
    client: {
      articles: {
        clearArticles: clearArticlesMock,
        createArticle: createArticleMock,
        getArticle: getArticleMock,
        listArticles: listArticlesMock,
        removeArticle: removeArticleMock,
        scanArticles: scanArticlesMock,
        updateArticle: updateArticleMock,
      },
    },
  },
}));

const LIST_INPUT: ListArticlesInput = {
  customerFolderPath: "/articles/customer-0001",
};

const CREATE_INPUT: CreateArticleInput = {
  customerFolderPath: "/articles/customer-0001",
  parameters: { CODE: "article-1" },
};

const UPDATE_INPUT: UpdateArticleInput = {
  customParameters: { FLAG: true },
  folderPath: "/articles/customer-0001/article-1",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("article actions", () => {
  it("forwards the list input", async () => {
    const page = { items: [], total: 0 };

    listArticlesMock.mockResolvedValue(page);

    await expect(listArticles(LIST_INPUT)).resolves.toBe(page);
    expect(listArticlesMock).toHaveBeenCalledWith(LIST_INPUT);
  });

  it("wraps the folder path for getArticle", async () => {
    const article = { folderPath: "/p" };

    getArticleMock.mockResolvedValue(article);

    await expect(getArticle("/p")).resolves.toBe(article);
    expect(getArticleMock).toHaveBeenCalledWith({ folderPath: "/p" });
  });

  it("forwards the createArticle input", async () => {
    const created = { folderPath: "/p" };

    createArticleMock.mockResolvedValue(created);

    await expect(createArticle(CREATE_INPUT)).resolves.toBe(created);
    expect(createArticleMock).toHaveBeenCalledWith(CREATE_INPUT);
  });

  it("forwards the updateArticle input", async () => {
    const updated = { folderPath: "/p" };

    updateArticleMock.mockResolvedValue(updated);

    await expect(updateArticle(UPDATE_INPUT)).resolves.toBe(updated);
    expect(updateArticleMock).toHaveBeenCalledWith(UPDATE_INPUT);
  });

  it("wraps the folder path for removeArticle", async () => {
    removeArticleMock.mockResolvedValue("/p");

    await expect(removeArticle("/p")).resolves.toBe("/p");
    expect(removeArticleMock).toHaveBeenCalledWith({ folderPath: "/p" });
  });

  it("forwards the empty scan input", async () => {
    const result = { created: 0 };

    scanArticlesMock.mockResolvedValue(result);

    await expect(scanArticles()).resolves.toBe(result);
    expect(scanArticlesMock).toHaveBeenCalledWith({});
  });

  it("calls clearArticles without arguments", async () => {
    clearArticlesMock.mockResolvedValue(3);

    await expect(clearArticles()).resolves.toBe(3);
    expect(clearArticlesMock).toHaveBeenCalledWith();
  });
});
