// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArticleServiceError } from "@/articles/errors";
import {
  ARTICLE_DATA_FILE_NAME,
  articleFolderFingerprint,
  assertArticleFolderDirectory,
  assertArticleFolderPath,
  assertCustomerFolderDirectory,
  assertCustomerFolderPath,
  assertSafeArticleFolderName,
  isPathInside,
  isSafeArticleFolderName,
  readArticleDataFile,
} from "@/articles/folder";
import { MAX_ARTICLE_DATA_BYTES } from "@/customers/folder";

let tempDir: string;
let root: string;
let customerFolder: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "articles-folder-"));
  root = path.join(tempDir, "articles");
  customerFolder = path.join(root, "customer-0001");

  await fs.mkdir(customerFolder, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tempDir, { force: true, recursive: true });
});

async function captureError(
  action: () => Promise<unknown>
): Promise<ArticleServiceError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof ArticleServiceError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected the call to reject.");
}

function captureSyncError(action: () => unknown): ArticleServiceError {
  try {
    action();
  } catch (error) {
    if (error instanceof ArticleServiceError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected the callback to throw.");
}

describe("isPathInside", () => {
  it("accepts the parent and nested children", () => {
    expect(isPathInside(tempDir, tempDir)).toBe(true);
    expect(isPathInside(tempDir, path.join(tempDir, "a", "b"))).toBe(true);
  });

  it("rejects siblings, escapes and NUL", () => {
    expect(
      isPathInside(path.join(tempDir, "a"), path.join(tempDir, "ab"))
    ).toBe(false);
    expect(isPathInside(tempDir, path.join(tempDir, ".."))).toBe(false);
    expect(isPathInside(tempDir, `${tempDir}\0`)).toBe(false);
  });
});

describe("assertCustomerFolderPath", () => {
  it("accepts a direct customer child of the root", () => {
    expect(assertCustomerFolderPath(root, customerFolder)).toEqual({
      customerCode: "0001",
      customerFolderName: "customer-0001",
      customerFolderPath: customerFolder,
    });
  });

  it("rejects the root itself and nested folders", () => {
    expect(
      captureSyncError(() => assertCustomerFolderPath(root, root))
    ).toMatchObject({ code: "ARTICLE_PATH_INVALID" });
    expect(
      captureSyncError(() =>
        assertCustomerFolderPath(root, path.join(customerFolder, "nested"))
      )
    ).toMatchObject({ code: "ARTICLE_PATH_INVALID" });
    expect(
      captureSyncError(() =>
        assertCustomerFolderPath(
          root,
          path.join(tempDir, "other", "customer-0001")
        )
      )
    ).toMatchObject({ code: "ARTICLE_PATH_INVALID" });
  });

  it("rejects an invalid customer folder name", () => {
    expect(
      captureSyncError(() =>
        assertCustomerFolderPath(root, path.join(root, "customer-0000"))
      )
    ).toMatchObject({ code: "ARTICLE_PATH_INVALID" });
    expect(
      captureSyncError(() =>
        assertCustomerFolderPath(root, path.join(root, "customer-001"))
      )
    ).toMatchObject({ code: "ARTICLE_PATH_INVALID" });
    expect(
      captureSyncError(() =>
        assertCustomerFolderPath(root, path.join(root, "other-0001"))
      )
    ).toMatchObject({ code: "ARTICLE_PATH_INVALID" });
  });

  it("rejects relative and NUL-containing paths", () => {
    expect(
      captureSyncError(() => assertCustomerFolderPath(root, "customer-0001"))
    ).toMatchObject({ code: "ARTICLE_PATH_INVALID" });
    expect(
      captureSyncError(() =>
        assertCustomerFolderPath(root, `${customerFolder}\0`)
      )
    ).toMatchObject({ code: "ARTICLE_PATH_INVALID" });
  });
});

describe("assertArticleFolderPath", () => {
  it("accepts an article that is a direct child of a customer folder", () => {
    const articleFolder = path.join(customerFolder, "article-1");

    expect(assertArticleFolderPath(root, articleFolder)).toEqual({
      articleFolderName: "article-1",
      articleFolderPath: articleFolder,
      customerCode: "0001",
      customerFolderName: "customer-0001",
      customerFolderPath: customerFolder,
    });
  });

  it("rejects an article directly under the root", () => {
    expect(
      captureSyncError(() =>
        assertArticleFolderPath(root, path.join(root, "article-1"))
      )
    ).toMatchObject({ code: "ARTICLE_PATH_INVALID" });
  });

  it("rejects a customer folder nested below the root", () => {
    const nested = path.join(root, "nested", "customer-0001", "article-1");

    expect(
      captureSyncError(() => assertArticleFolderPath(root, nested))
    ).toMatchObject({ code: "ARTICLE_PATH_INVALID" });
  });

  it("rejects an invalid customer folder name", () => {
    expect(
      captureSyncError(() =>
        assertArticleFolderPath(
          root,
          path.join(root, "customer-0000", "article-1")
        )
      )
    ).toMatchObject({ code: "ARTICLE_PATH_INVALID" });
  });

  it("rejects relative and NUL-containing paths", () => {
    expect(
      captureSyncError(() =>
        assertArticleFolderPath(root, "customer-0001/article-1")
      )
    ).toMatchObject({ code: "ARTICLE_PATH_INVALID" });
    expect(
      captureSyncError(() =>
        assertArticleFolderPath(
          root,
          `${path.join(customerFolder, "article-1")}\0`
        )
      )
    ).toMatchObject({ code: "ARTICLE_PATH_INVALID" });
  });
});

describe("article folder name safety", () => {
  it("accepts a normal rendered key", () => {
    expect(isSafeArticleFolderName("article-example-2_EVO01")).toBe(true);
    expect(isSafeArticleFolderName("a b")).toBe(true);
    expect(assertSafeArticleFolderName("REV_1")).toBe("REV_1");
  });

  it("rejects unsafe names", () => {
    for (const name of [
      "",
      ".",
      "..",
      ".hidden",
      ".article-1",
      "a/b",
      "a\\b",
      "a:b",
      "a*b",
      'a"b',
      "a<b",
      "a>b",
      "a|b",
      "a?b",
      "a.",
      "a ",
      "CON",
      "nul.txt",
      "a".repeat(256),
    ]) {
      expect(isSafeArticleFolderName(name)).toBe(false);
      expect(
        captureSyncError(() => assertSafeArticleFolderName(name))
      ).toMatchObject({ code: "ARTICLE_FOLDER_NAME_INVALID" });
    }
  });
});

describe("assertCustomerFolderDirectory", () => {
  it("accepts a real directory", async () => {
    await expect(
      assertCustomerFolderDirectory(customerFolder)
    ).resolves.toBeUndefined();
  });

  it("reports a missing customer folder", async () => {
    expect(
      await captureError(() =>
        assertCustomerFolderDirectory(path.join(root, "customer-0002"))
      )
    ).toMatchObject({ code: "ARTICLE_CUSTOMER_NOT_FOUND" });
  });

  it("reports a non-directory customer folder", async () => {
    const file = path.join(root, "customer-0002");

    await fs.writeFile(file, "not a directory");

    expect(
      await captureError(() => assertCustomerFolderDirectory(file))
    ).toMatchObject({ code: "ARTICLE_CUSTOMER_NOT_DIRECTORY" });
  });

  it.skipIf(process.platform === "win32")(
    "reports a symlinked customer folder",
    async () => {
      const target = path.join(tempDir, "real-customer");
      const link = path.join(root, "customer-0002");

      await fs.mkdir(target);
      await fs.symlink(target, link, "dir");

      expect(
        await captureError(() => assertCustomerFolderDirectory(link))
      ).toMatchObject({ code: "ARTICLE_CUSTOMER_SYMLINK" });
    }
  );
});

describe("assertArticleFolderDirectory", () => {
  it("accepts a real directory", async () => {
    const articleFolder = path.join(customerFolder, "article-1");

    await fs.mkdir(articleFolder);

    await expect(
      assertArticleFolderDirectory(articleFolder)
    ).resolves.toBeUndefined();
  });

  it("reports a missing article folder", async () => {
    expect(
      await captureError(() =>
        assertArticleFolderDirectory(path.join(customerFolder, "missing"))
      )
    ).toMatchObject({ code: "ARTICLE_NOT_FOUND" });
  });

  it("reports a non-directory article folder", async () => {
    const file = path.join(customerFolder, "article-1");

    await fs.writeFile(file, "not a directory");

    expect(
      await captureError(() => assertArticleFolderDirectory(file))
    ).toMatchObject({ code: "ARTICLE_FOLDER_NOT_DIRECTORY" });
  });

  it.skipIf(process.platform === "win32")(
    "reports a symlinked article folder",
    async () => {
      const target = path.join(tempDir, "real-article");
      const link = path.join(customerFolder, "article-1");

      await fs.mkdir(target);
      await fs.symlink(target, link, "dir");

      expect(
        await captureError(() => assertArticleFolderDirectory(link))
      ).toMatchObject({ code: "ARTICLE_FOLDER_SYMLINK" });
    }
  );
});

describe("articleFolderFingerprint", () => {
  it("returns the newest mtime of the folder and its data file", async () => {
    const articleFolder = path.join(customerFolder, "article-1");
    const dataPath = path.join(articleFolder, ARTICLE_DATA_FILE_NAME);
    const folderTime = new Date("2023-11-14T22:13:20.000Z");
    const dataTime = new Date("2023-11-14T22:15:00.000Z");

    await fs.mkdir(articleFolder);
    await fs.writeFile(dataPath, "{}");
    await fs.utimes(articleFolder, folderTime, folderTime);
    await fs.utimes(dataPath, dataTime, dataTime);

    const [folderStats, dataStats] = await Promise.all([
      fs.lstat(articleFolder),
      fs.lstat(dataPath),
    ]);

    await expect(articleFolderFingerprint(articleFolder)).resolves.toBe(
      Math.floor(Math.max(folderStats.mtimeMs, dataStats.mtimeMs))
    );
  });

  it("returns zero when the folder is missing", async () => {
    await expect(
      articleFolderFingerprint(path.join(tempDir, "missing"))
    ).resolves.toBe(0);
  });
});

describe("readArticleDataFile", () => {
  let articleFolder: string;

  beforeEach(async () => {
    articleFolder = path.join(customerFolder, "article-1");
    await fs.mkdir(articleFolder);
  });

  it("parses valid JSON", async () => {
    const file = path.join(articleFolder, ARTICLE_DATA_FILE_NAME);

    await fs.writeFile(file, JSON.stringify({ value: 42 }));

    await expect(readArticleDataFile(file)).resolves.toEqual({ value: 42 });
  });

  it("reports a missing file", async () => {
    expect(
      await captureError(() =>
        readArticleDataFile(path.join(articleFolder, ARTICLE_DATA_FILE_NAME))
      )
    ).toMatchObject({ code: "ARTICLE_DATA_MISSING" });
  });

  it("reports malformed JSON", async () => {
    const file = path.join(articleFolder, ARTICLE_DATA_FILE_NAME);

    await fs.writeFile(file, "{ broken");

    expect(await captureError(() => readArticleDataFile(file))).toMatchObject({
      code: "ARTICLE_DATA_INVALID_JSON",
    });
  });

  it("keeps absolute paths and JSON.parse text out of the error message", async () => {
    const file = path.join(articleFolder, ARTICLE_DATA_FILE_NAME);

    await fs.writeFile(file, "{ secret-token");

    const error = (await captureError(() =>
      readArticleDataFile(file)
    )) as Error;

    expect(error.message).not.toContain(articleFolder);
    expect(error.message).not.toContain("secret-token");
  });

  it("reports an oversized file", async () => {
    const file = path.join(articleFolder, ARTICLE_DATA_FILE_NAME);

    await fs.writeFile(
      file,
      JSON.stringify({ padding: "x".repeat(MAX_ARTICLE_DATA_BYTES + 1) })
    );

    expect(await captureError(() => readArticleDataFile(file))).toMatchObject({
      code: "ARTICLE_DATA_UNREADABLE",
    });
  });

  it("reports a directory", async () => {
    const file = path.join(articleFolder, ARTICLE_DATA_FILE_NAME);

    await fs.mkdir(file);

    expect(await captureError(() => readArticleDataFile(file))).toMatchObject({
      code: "ARTICLE_DATA_UNREADABLE",
    });
  });

  it.skipIf(process.platform === "win32")("reports a symlink", async () => {
    const target = path.join(tempDir, "outside.json");
    const file = path.join(articleFolder, ARTICLE_DATA_FILE_NAME);

    await fs.writeFile(target, "{}");
    await fs.symlink(target, file);

    expect(await captureError(() => readArticleDataFile(file))).toMatchObject({
      code: "ARTICLE_DATA_UNREADABLE",
    });
  });

  it("rejects relative and NUL-containing paths", async () => {
    expect(
      await captureError(() => readArticleDataFile("article_data.json"))
    ).toMatchObject({ code: "ARTICLE_DATA_UNREADABLE" });
    expect(
      await captureError(() =>
        readArticleDataFile(
          `${path.join(articleFolder, ARTICLE_DATA_FILE_NAME)}\0`
        )
      )
    ).toMatchObject({ code: "ARTICLE_DATA_UNREADABLE" });
  });
});
