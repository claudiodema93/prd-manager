// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countValidRevisions } from "@/articles/revisions";
import { scanArticles } from "@/articles/scan";
import { type ArticleDatabase, getArticleRow } from "@/articles/store";
import type { CustomerSectionDefinition } from "@/customers/types";
import { articles, customers } from "@/db/schema";

/**
 * Some network/FUSE filesystems report `DT_UNKNOWN`, so a `Dirent` answers
 * neither `isDirectory()` nor `isFile()`. There is no public seam to hand such
 * an entry to the domain code, so this file injects it at the filesystem
 * boundary: `opendir` returns ambiguous entries for the paths registered in
 * `direntControl`, and everything else delegates to the real implementation.
 * The `lstat` fallback therefore still inspects the real temporary files.
 */
const direntControl = vi.hoisted(() => ({
  entries: new Map<string, string[]>(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const pathModule = await import("node:path");

  const ambiguousDirent = (name: string) => ({
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isDirectory: () => false,
    isFIFO: () => false,
    isFile: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    name,
  });

  const fakeDirectory = (names: readonly string[]) => {
    let readCursor = 0;

    return {
      close: async () => undefined,
      read: () => {
        if (readCursor >= names.length) {
          return null;
        }

        const name = names[readCursor] as string;

        readCursor += 1;

        return ambiguousDirent(name);
      },
      [Symbol.asyncIterator]() {
        let iterationCursor = 0;

        return {
          next: () => {
            if (iterationCursor >= names.length) {
              return { done: true as const, value: undefined };
            }

            const name = names[iterationCursor] as string;

            iterationCursor += 1;

            return { done: false as const, value: ambiguousDirent(name) };
          },
        };
      },
    };
  };

  return {
    ...actual,
    opendir: ((target: string) => {
      const injected = direntControl.entries.get(pathModule.resolve(target));

      if (injected === undefined) {
        return actual.opendir(target);
      }

      return Promise.resolve(fakeDirectory(injected));
    }) as unknown as typeof actual.opendir,
  };
});

const CONFIG_FILE = "customer_data.json";
const ARTICLE_FILE = "article_data.json";
const FOLDER_NAME = "customer-0001";

const REVISION: CustomerSectionDefinition = {
  key: "REV_{REV}",
  parameters: { REV: { default: "0", required: false, type: "number" } },
  schemaVersion: 1,
};

function validConfig(): Record<string, unknown> {
  return {
    article: {
      key: "{CODE}[_EVO{EVO:00}]",
      parameters: {
        CODE: { required: true, type: "text" },
        EVO: { default: "0", required: false, type: "number" },
      },
      schemaVersion: 1,
    },
    customerName: "Acme Srl",
    revision: REVISION,
    schemaVersion: 1,
  };
}

function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("countValidRevisions with an ambiguous Dirent", () => {
  let tempDir: string;
  let articleFolder: string;

  beforeEach(async () => {
    direntControl.entries.clear();
    tempDir = await makeTempDir("articles-dt-unknown-rev-");
    articleFolder = path.join(tempDir, FOLDER_NAME, "article-1");

    await fs.mkdir(articleFolder, { recursive: true });
  });

  afterEach(async () => {
    direntControl.entries.clear();
    await fs.rm(tempDir, { force: true, recursive: true });
  });

  it("counts an entry the fallback finds to be a real directory", async () => {
    await fs.mkdir(path.join(articleFolder, "REV_1"));
    await fs.writeFile(path.join(articleFolder, "REV_2"), "not a directory");
    direntControl.entries.set(path.resolve(articleFolder), ["REV_1", "REV_2"]);

    await expect(countValidRevisions(articleFolder, REVISION)).resolves.toBe(1);
  });

  it.skipIf(process.platform === "win32")(
    "does not count an ambiguous symlink",
    async () => {
      const target = path.join(tempDir, "real-revision");

      await fs.mkdir(target);
      await fs.symlink(target, path.join(articleFolder, "REV_1"), "dir");
      direntControl.entries.set(path.resolve(articleFolder), ["REV_1"]);

      await expect(countValidRevisions(articleFolder, REVISION)).resolves.toBe(
        0
      );
    }
  );

  it("treats an unreadable entry as not a directory", async () => {
    direntControl.entries.set(path.resolve(articleFolder), ["REV_9"]);

    await expect(countValidRevisions(articleFolder, REVISION)).resolves.toBe(0);
  });
});

describe("scanArticles with an ambiguous Dirent", () => {
  let sqlite: Database.Database;
  let db: ArticleDatabase;
  let root: string;

  beforeEach(async () => {
    direntControl.entries.clear();
    sqlite = new Database(":memory:");
    const database = drizzle({
      client: sqlite,
      schema: { articles, customers },
    });

    migrate(database, {
      migrationsFolder: path.resolve(import.meta.dirname, "../../../drizzle"),
    });

    db = database as ArticleDatabase;
    root = await makeTempDir("articles-dt-unknown-scan-");
  });

  afterEach(async () => {
    sqlite.close();
    direntControl.entries.clear();
    await fs.rm(root, { force: true, recursive: true });
  });

  async function createCustomer(): Promise<string> {
    const folderPath = path.join(root, FOLDER_NAME);

    await fs.mkdir(folderPath, { recursive: true });
    await fs.writeFile(
      path.join(folderPath, CONFIG_FILE),
      JSON.stringify(validConfig())
    );

    return folderPath;
  }

  it("caches an entry the fallback finds to be a real directory", async () => {
    const customerPath = await createCustomer();
    const articlePath = path.join(customerPath, "article-1");

    await fs.mkdir(articlePath);
    await fs.writeFile(
      path.join(articlePath, ARTICLE_FILE),
      JSON.stringify({ CODE: "article-1", customer: 1, schemaVersion: 1 })
    );
    direntControl.entries.set(path.resolve(customerPath), ["article-1"]);

    const result = await scanArticles({ db, rootDirectory: root });

    expect(result).toMatchObject({
      created: 1,
      issues: [],
      removed: 0,
      scanned: 1,
      unchanged: 0,
      updated: 0,
    });
    expect(getArticleRow(db, articlePath)).toMatchObject({
      folderName: "article-1",
      folderPath: articlePath,
    });
  });

  it.skipIf(process.platform === "win32")(
    "reports an ambiguous symlink and an ambiguous non-directory",
    async () => {
      const customerPath = await createCustomer();
      const target = path.join(root, "outside-article");

      await fs.mkdir(target);
      await fs.symlink(target, path.join(customerPath, "linked"), "dir");
      await fs.writeFile(path.join(customerPath, "loose"), "not a directory");
      direntControl.entries.set(path.resolve(customerPath), [
        "linked",
        "loose",
      ]);

      const result = await scanArticles({ db, rootDirectory: root });

      expect(result).toMatchObject({ created: 0, scanned: 0 });
      expect(result.issues.map((issue) => issue.code).sort()).toEqual(
        ["ARTICLE_FOLDER_SYMLINK", "ARTICLE_FOLDER_NOT_DIRECTORY"].sort()
      );
    }
  );
});
