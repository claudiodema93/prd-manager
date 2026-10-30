// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countValidArticles,
  customerFolderNameForCode,
  isPathInside,
  MAX_ARTICLE_DATA_BYTES,
  moveCustomerToTrash,
  parseCustomerFolderName,
  readJsonFile,
  writeJsonAtomic,
} from "@/customers/folder";

const CUSTOMER_CODE = "0001";
const FOLDER_NAME = "customer-0001";
const ARTICLE_FILE = "article_data.json";
const MISSING_ARTICLE_PATTERN = /missing article_data\.json/iu;
const TOO_MANY_ISSUES_PATTERN = /too many article issues/iu;
const TRASH_SUFFIX_PATTERN = /-\d+(?:-\d+)?$/u;

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "customer-folder-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { force: true, recursive: true });
});

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }

  throw new Error("Expected the call to throw.");
}

async function captureAsyncError(
  action: () => Promise<unknown>
): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }

  throw new Error("Expected the call to reject.");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createArticle(
  customerFolderPath: string,
  name: string,
  value: unknown
): Promise<string> {
  const articleFolder = path.join(customerFolderPath, name);

  await fs.mkdir(articleFolder, { recursive: true });
  await fs.writeFile(
    path.join(articleFolder, ARTICLE_FILE),
    JSON.stringify(value)
  );

  return articleFolder;
}

describe("parseCustomerFolderName", () => {
  it("parses a valid customer folder name", () => {
    expect(parseCustomerFolderName("customer-0001")).toEqual({
      customerCode: "0001",
      folderName: "customer-0001",
    });
    expect(parseCustomerFolderName("customer-9999")).toEqual({
      customerCode: "9999",
      folderName: "customer-9999",
    });
  });

  it("rejects the reserved code 0000", () => {
    expect(parseCustomerFolderName("customer-0000")).toBeNull();
  });

  it("rejects names that do not match customer-XXXX", () => {
    for (const name of [
      "customer-001",
      "customer-00001",
      "customer-abcd",
      "customer-0001-extra",
      "Customer-0001",
      "customer-0001 ",
      "",
    ]) {
      expect(parseCustomerFolderName(name)).toBeNull();
    }
  });
});

describe("customerFolderNameForCode", () => {
  it("builds the folder name for a valid code", () => {
    expect(customerFolderNameForCode("0001")).toBe("customer-0001");
    expect(customerFolderNameForCode("9999")).toBe("customer-9999");
  });

  it("rejects invalid codes", () => {
    for (const code of ["0000", "1", "00001", "abcd", ""]) {
      expect(captureError(() => customerFolderNameForCode(code))).toMatchObject(
        {
          code: "CUSTOMER_CODE_INVALID",
        }
      );
    }
  });
});

describe("isPathInside", () => {
  it("accepts the parent itself", () => {
    expect(isPathInside(tempDir, tempDir)).toBe(true);
    expect(isPathInside(tempDir, path.join(tempDir, "."))).toBe(true);
  });

  it("accepts a nested child", () => {
    expect(isPathInside(tempDir, path.join(tempDir, "a", "b"))).toBe(true);
  });

  it("rejects a sibling sharing a name prefix", () => {
    expect(
      isPathInside(path.join(tempDir, "a"), path.join(tempDir, "ab"))
    ).toBe(false);
  });

  it("rejects a path that escapes through ..", () => {
    expect(isPathInside(tempDir, path.join(tempDir, ".."))).toBe(false);
    expect(
      isPathInside(path.join(tempDir, "a"), path.join(tempDir, "a", "..", "b"))
    ).toBe(false);
  });
});

describe("readJsonFile", () => {
  it("returns undefined when the file is missing", async () => {
    await expect(
      readJsonFile(path.join(tempDir, "missing.json"), 1024)
    ).resolves.toBeUndefined();
  });

  it("parses valid JSON", async () => {
    const file = path.join(tempDir, "valid.json");

    await fs.writeFile(file, JSON.stringify({ value: 42 }));

    await expect(readJsonFile(file, 1024)).resolves.toEqual({ value: 42 });
  });

  it("rejects malformed JSON with CONFIG_INVALID_JSON", async () => {
    const file = path.join(tempDir, "broken.json");

    await fs.writeFile(file, "{ not json");

    await expect(
      captureAsyncError(() => readJsonFile(file, 1024))
    ).resolves.toMatchObject({ code: "CONFIG_INVALID_JSON" });
  });

  it("rejects a symlink with READ_FAILED", async () => {
    const target = path.join(tempDir, "target.json");
    const link = path.join(tempDir, "link.json");

    await fs.writeFile(target, JSON.stringify({ ok: true }));
    await fs.symlink(target, link);

    expect(
      await captureAsyncError(() => readJsonFile(link, 1024))
    ).toMatchObject({ code: "READ_FAILED" });
  });

  it("rejects an oversized file with READ_FAILED", async () => {
    const file = path.join(tempDir, "large.json");

    await fs.writeFile(
      file,
      JSON.stringify({ padding: "x".repeat(MAX_ARTICLE_DATA_BYTES + 16) })
    );

    expect(
      await captureAsyncError(() => readJsonFile(file, MAX_ARTICLE_DATA_BYTES))
    ).toMatchObject({ code: "READ_FAILED" });
  });
});

describe("writeJsonAtomic", () => {
  it("writes two-space indented JSON with a trailing newline", async () => {
    const file = path.join(tempDir, "written.json");
    const value = { alpha: 1, nested: { beta: true } };

    await writeJsonAtomic(file, value);

    await expect(fs.readFile(file, "utf8")).resolves.toBe(
      `${JSON.stringify(value, null, 2)}\n`
    );
  });

  it("replaces an existing file", async () => {
    const file = path.join(tempDir, "replace.json");

    await fs.writeFile(file, "old contents");
    await writeJsonAtomic(file, { replaced: true });

    await expect(fs.readFile(file, "utf8")).resolves.toBe(
      `${JSON.stringify({ replaced: true }, null, 2)}\n`
    );
  });

  it("leaves no temporary files behind", async () => {
    const file = path.join(tempDir, "clean.json");

    await writeJsonAtomic(file, { clean: true });

    const entries = await fs.readdir(tempDir);

    expect(entries).toEqual(["clean.json"]);
    expect(entries.some((entry) => entry.includes(".tmp-"))).toBe(false);
  });

  it("cleans up the temporary file when the target is a non-empty directory", async () => {
    const target = path.join(tempDir, "target.json");

    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "keep.txt"), "keep");

    expect(
      await captureAsyncError(() => writeJsonAtomic(target, { value: 1 }))
    ).toMatchObject({ code: "WRITE_FAILED" });

    const entries = await fs.readdir(tempDir);

    expect(entries).toContain("target.json");
    expect(entries.some((entry) => entry.startsWith(".target.json.tmp-"))).toBe(
      false
    );
    expect((await fs.lstat(target)).isDirectory()).toBe(true);
    await expect(
      fs.readFile(path.join(target, "keep.txt"), "utf8")
    ).resolves.toBe("keep");
  });
});

describe("countValidArticles", () => {
  it("counts a valid article and reports no issues", async () => {
    const customerFolder = path.join(tempDir, FOLDER_NAME);

    await createArticle(customerFolder, "article-1", {
      customer: "0001",
      schemaVersion: 1,
    });

    const result = await countValidArticles(customerFolder, CUSTOMER_CODE);

    expect(result.articleCount).toBe(1);
    expect(result.issues).toEqual([]);
  });

  it("accepts a numeric customer code equal to the folder code", async () => {
    const customerFolder = path.join(tempDir, FOLDER_NAME);

    await createArticle(customerFolder, "article-1", {
      customer: 1,
      schemaVersion: 2,
    });

    const result = await countValidArticles(customerFolder, CUSTOMER_CODE);

    expect(result.articleCount).toBe(1);
    expect(result.issues).toEqual([]);
  });

  it("warns about a missing article_data.json", async () => {
    const customerFolder = path.join(tempDir, FOLDER_NAME);

    await fs.mkdir(path.join(customerFolder, "article-1"), { recursive: true });

    const result = await countValidArticles(customerFolder, CUSTOMER_CODE);

    expect(result.articleCount).toBe(0);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: "ARTICLE_INVALID",
      severity: "warning",
    });
    expect(result.issues[0]?.message).toMatch(MISSING_ARTICLE_PATTERN);
  });

  it("warns about invalid JSON", async () => {
    const customerFolder = path.join(tempDir, FOLDER_NAME);
    const articleFolder = path.join(customerFolder, "article-1");

    await fs.mkdir(articleFolder, { recursive: true });
    await fs.writeFile(path.join(articleFolder, ARTICLE_FILE), "{ broken");

    const result = await countValidArticles(customerFolder, CUSTOMER_CODE);

    expect(result.articleCount).toBe(0);
    expect(result.issues[0]).toMatchObject({ code: "ARTICLE_INVALID" });
  });

  it("warns about an article belonging to a different customer", async () => {
    const customerFolder = path.join(tempDir, FOLDER_NAME);

    await createArticle(customerFolder, "article-1", {
      customer: "0002",
      schemaVersion: 1,
    });

    const result = await countValidArticles(customerFolder, CUSTOMER_CODE);

    expect(result.articleCount).toBe(0);
    expect(result.issues[0]).toMatchObject({ code: "ARTICLE_INVALID" });
  });

  it("warns about array and null article data", async () => {
    const customerFolder = path.join(tempDir, FOLDER_NAME);

    await createArticle(customerFolder, "article-array", []);
    await createArticle(customerFolder, "article-null", null);

    const result = await countValidArticles(customerFolder, CUSTOMER_CODE);

    expect(result.articleCount).toBe(0);
    expect(result.issues).toHaveLength(2);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "ARTICLE_INVALID",
      "ARTICLE_INVALID",
    ]);
  });

  it("warns about a symlinked article folder without counting it", async () => {
    const customerFolder = path.join(tempDir, FOLDER_NAME);
    const realArticle = path.join(tempDir, "elsewhere");

    await fs.mkdir(customerFolder, { recursive: true });
    await fs.mkdir(realArticle, { recursive: true });
    await fs.writeFile(
      path.join(realArticle, ARTICLE_FILE),
      JSON.stringify({ customer: "0001", schemaVersion: 1 })
    );
    await fs.symlink(realArticle, path.join(customerFolder, "linked"));

    const result = await countValidArticles(customerFolder, CUSTOMER_CODE);

    expect(result.articleCount).toBe(0);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ code: "ARTICLE_SYMLINK" });
  });

  it("ignores hidden folders", async () => {
    const customerFolder = path.join(tempDir, FOLDER_NAME);

    await fs.mkdir(path.join(customerFolder, ".hidden"), { recursive: true });

    const result = await countValidArticles(customerFolder, CUSTOMER_CODE);

    expect(result.articleCount).toBe(0);
    expect(result.issues).toEqual([]);
  });

  it("ignores regular files", async () => {
    const customerFolder = path.join(tempDir, FOLDER_NAME);

    await fs.mkdir(customerFolder, { recursive: true });
    await fs.writeFile(path.join(customerFolder, "notes.txt"), "hello");

    const result = await countValidArticles(customerFolder, CUSTOMER_CODE);

    expect(result.articleCount).toBe(0);
    expect(result.issues).toEqual([]);
  });

  it("caps issues at 100 entries and notes the truncation", async () => {
    const customerFolder = path.join(tempDir, FOLDER_NAME);

    const directories = Array.from({ length: 150 }, (_value, index) =>
      path.join(customerFolder, `article-${String(index).padStart(3, "0")}`)
    );

    await Promise.all(
      directories.map((directory) => fs.mkdir(directory, { recursive: true }))
    );

    const result = await countValidArticles(customerFolder, CUSTOMER_CODE);

    expect(result.articleCount).toBe(0);
    expect(result.issues).toHaveLength(100);
    expect(result.issues.at(-1)?.message).toMatch(TOO_MANY_ISSUES_PATTERN);
  });

  it("rejects a customer folder above the entry budget", async () => {
    const customerFolder = path.join(tempDir, FOLDER_NAME);

    await Promise.all([
      fs.mkdir(path.join(customerFolder, "article-1"), { recursive: true }),
      fs.mkdir(path.join(customerFolder, "article-2"), { recursive: true }),
    ]);

    expect(
      await captureAsyncError(() =>
        countValidArticles(customerFolder, CUSTOMER_CODE, { maxEntries: 1 })
      )
    ).toMatchObject({ code: "READ_FAILED" });
  });
});

describe("moveCustomerToTrash", () => {
  it("moves a customer folder into the trash", async () => {
    const trashDirectory = path.join(tempDir, "trash");
    const sourceFolderPath = path.join(tempDir, FOLDER_NAME);

    await fs.mkdir(trashDirectory);
    await fs.mkdir(sourceFolderPath);
    await fs.writeFile(path.join(sourceFolderPath, "note.txt"), "hello");

    const destination = await moveCustomerToTrash({
      folderName: FOLDER_NAME,
      sourceFolderPath,
      trashDirectory,
    });

    expect(destination).toBe(path.join(trashDirectory, FOLDER_NAME));
    await expect(pathExists(sourceFolderPath)).resolves.toBe(false);
    await expect(
      fs.readFile(path.join(destination, "note.txt"), "utf8")
    ).resolves.toBe("hello");
  });

  it("adds a suffix when the destination already exists", async () => {
    const trashDirectory = path.join(tempDir, "trash");
    const sourceFolderPath = path.join(tempDir, FOLDER_NAME);
    const original = path.join(trashDirectory, FOLDER_NAME);

    await fs.mkdir(original, { recursive: true });
    await fs.mkdir(sourceFolderPath);

    const destination = await moveCustomerToTrash({
      folderName: FOLDER_NAME,
      sourceFolderPath,
      trashDirectory,
    });

    expect(destination).not.toBe(original);
    expect(destination.startsWith(`${original}-`)).toBe(true);
    expect(path.basename(destination)).toMatch(TRASH_SUFFIX_PATTERN);
    await expect(pathExists(destination)).resolves.toBe(true);
  });

  it("fails with TRASH_NOT_FOUND when the trash directory is missing", async () => {
    const sourceFolderPath = path.join(tempDir, FOLDER_NAME);

    await fs.mkdir(sourceFolderPath);

    expect(
      await captureAsyncError(() =>
        moveCustomerToTrash({
          folderName: FOLDER_NAME,
          sourceFolderPath,
          trashDirectory: path.join(tempDir, "missing-trash"),
        })
      )
    ).toMatchObject({ code: "TRASH_NOT_FOUND" });
  });

  it("fails with TRASH_NOT_DIRECTORY when the trash path is a file", async () => {
    const trashFile = path.join(tempDir, "trash-file");
    const sourceFolderPath = path.join(tempDir, FOLDER_NAME);

    await fs.writeFile(trashFile, "not a directory");
    await fs.mkdir(sourceFolderPath);

    expect(
      await captureAsyncError(() =>
        moveCustomerToTrash({
          folderName: FOLDER_NAME,
          sourceFolderPath,
          trashDirectory: trashFile,
        })
      )
    ).toMatchObject({ code: "TRASH_NOT_DIRECTORY" });
  });

  it("fails with TRASH_SYMLINK when the trash path is a symlink", async () => {
    const realTrash = path.join(tempDir, "real-trash");
    const trashLink = path.join(tempDir, "trash-link");
    const sourceFolderPath = path.join(tempDir, FOLDER_NAME);

    await fs.mkdir(realTrash);
    await fs.symlink(realTrash, trashLink);
    await fs.mkdir(sourceFolderPath);

    expect(
      await captureAsyncError(() =>
        moveCustomerToTrash({
          folderName: FOLDER_NAME,
          sourceFolderPath,
          trashDirectory: trashLink,
        })
      )
    ).toMatchObject({ code: "TRASH_SYMLINK" });
  });

  it("fails with CUSTOMER_FOLDER_SYMLINK when the source is a symlink", async () => {
    const trashDirectory = path.join(tempDir, "trash");
    const realFolder = path.join(tempDir, "real-source");
    const sourceLink = path.join(tempDir, "source-link");

    await fs.mkdir(trashDirectory);
    await fs.mkdir(realFolder);
    await fs.symlink(realFolder, sourceLink);

    expect(
      await captureAsyncError(() =>
        moveCustomerToTrash({
          folderName: FOLDER_NAME,
          sourceFolderPath: sourceLink,
          trashDirectory,
        })
      )
    ).toMatchObject({ code: "CUSTOMER_FOLDER_SYMLINK" });
  });

  it("fails with CUSTOMER_NOT_FOUND when the source is missing", async () => {
    const trashDirectory = path.join(tempDir, "trash");

    await fs.mkdir(trashDirectory);

    expect(
      await captureAsyncError(() =>
        moveCustomerToTrash({
          folderName: FOLDER_NAME,
          sourceFolderPath: path.join(tempDir, "missing-source"),
          trashDirectory,
        })
      )
    ).toMatchObject({ code: "CUSTOMER_NOT_FOUND" });
  });

  it("rejects invalid customer folder names", async () => {
    const trashDirectory = path.join(tempDir, "trash");
    const sourceFolderPath = path.join(tempDir, FOLDER_NAME);

    await fs.mkdir(trashDirectory);
    await fs.mkdir(sourceFolderPath);

    const errors = await Promise.all(
      [".", "..", "../x", "a/b", "a\\b", ""].map((folderName) =>
        captureAsyncError(() =>
          moveCustomerToTrash({
            folderName,
            sourceFolderPath,
            trashDirectory,
          })
        )
      )
    );

    for (const error of errors) {
      expect(error).toMatchObject({ code: "CUSTOMER_FOLDER_NAME_INVALID" });
    }
  });

  it("fails with CUSTOMER_FOLDER_NOT_DIRECTORY when the source is a regular file", async () => {
    const trashDirectory = path.join(tempDir, "trash");
    const sourceFolderPath = path.join(tempDir, FOLDER_NAME);

    await fs.mkdir(trashDirectory);
    await fs.writeFile(sourceFolderPath, "not a folder");

    expect(
      await captureAsyncError(() =>
        moveCustomerToTrash({
          folderName: FOLDER_NAME,
          sourceFolderPath,
          trashDirectory,
        })
      )
    ).toMatchObject({ code: "CUSTOMER_FOLDER_NOT_DIRECTORY" });
  });

  it("fails with TRASH_MOVE_FAILED when the trash directory is inside the source", async () => {
    const sourceFolderPath = path.join(tempDir, FOLDER_NAME);
    const nestedTrash = path.join(sourceFolderPath, "trash");

    await fs.mkdir(nestedTrash, { recursive: true });

    expect(
      await captureAsyncError(() =>
        moveCustomerToTrash({
          folderName: FOLDER_NAME,
          sourceFolderPath,
          trashDirectory: nestedTrash,
        })
      )
    ).toMatchObject({ code: "TRASH_MOVE_FAILED" });
  });
});
