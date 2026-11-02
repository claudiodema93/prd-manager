// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { call } from "@orpc/server";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ArticleRecord,
  type UpsertArticleRowInput,
  upsertArticleRow,
} from "@/articles/store";
import type { ArticleCacheMetadata } from "@/articles/types";
import { articles, customers } from "@/db/schema";
import {
  clearArticles,
  createArticle,
  getArticle,
  listArticles,
  removeArticle,
  scanArticles,
  updateArticle,
} from "@/ipc/articles/handlers";

const state = vi.hoisted(() => ({ db: undefined as unknown }));

const preferencesState = vi.hoisted(() => ({
  folders: {
    articlesDirectory: null as string | null,
    issuesDirectory: null as string | null,
    trashDirectory: null as string | null,
  },
}));

vi.mock("@/db", () => ({
  getDatabase: () => {
    if (!state.db) {
      throw new Error(
        "Database has not been initialised. Call initDatabase() first."
      );
    }

    return state.db;
  },
}));

vi.mock("@/preferences/store", () => ({
  getFoldersPreference: () => ({ ...preferencesState.folders }),
}));

const schema = { articles, customers };
type TestDatabase = ReturnType<typeof drizzle<typeof schema>>;

const CONFIG_FILE = "customer_data.json";
const ARTICLE_FILE = "article_data.json";
const CUSTOMER_CODE = "0001";
const FOLDER_NAME = "customer-0001";
const ARTICLE_FOLDER_NAME = "article-1";

const ARTICLE = {
  key: "{CODE}[_EVO{EVO:00}]",
  parameters: {
    CODE: { required: true, type: "text" as const },
    EVO: { default: "0", required: false, type: "number" as const },
  },
  schemaVersion: 1,
};

const REVISION = {
  key: "REV_{REV}",
  parameters: {
    REV: { default: "0", required: false, type: "number" as const },
  },
  schemaVersion: 1,
};

function metadata(
  overrides: Partial<ArticleCacheMetadata> = {}
): ArticleCacheMetadata {
  return {
    activeRevision: "REV_1",
    customer: 1,
    customParameters: {},
    parameters: { CODE: ARTICLE_FOLDER_NAME, EVO: "0" },
    schemaVersion: 1,
    ...overrides,
  };
}

let sqlite: Database.Database;
let database: TestDatabase;
let tempDir: string;
let articlesDirectory: string;
let trashDirectory: string;

function customerFolderPath(code = CUSTOMER_CODE): string {
  return path.join(articlesDirectory, `customer-${code}`);
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "articles-handlers-"));
  articlesDirectory = path.join(tempDir, "articles");
  trashDirectory = path.join(tempDir, "trash");

  await fs.mkdir(articlesDirectory);
  await fs.mkdir(trashDirectory);

  sqlite = new Database(":memory:");
  database = drizzle({ client: sqlite, schema });
  migrate(database, {
    migrationsFolder: path.resolve(import.meta.dirname, "../../../drizzle"),
  });
  state.db = database;

  preferencesState.folders = {
    articlesDirectory,
    issuesDirectory: null,
    trashDirectory,
  };
});

afterEach(async () => {
  sqlite.close();
  await fs.rm(tempDir, { force: true, recursive: true });
});

function seedArticle(
  options: {
    customerFolderPath?: string;
    folderName?: string;
    metadata?: ArticleCacheMetadata;
  } = {}
): ArticleRecord {
  const folderPath = options.customerFolderPath ?? customerFolderPath();
  const folderName = options.folderName ?? ARTICLE_FOLDER_NAME;

  return upsertArticleRow(database, {
    activeRevision: options.metadata?.activeRevision ?? "REV_1",
    customerCode: path.basename(folderPath).slice("customer-".length),
    customerFolderPath: folderPath,
    folderMtimeMs: 1_700_000_000_000,
    folderName,
    folderPath: path.join(folderPath, folderName),
    metadata: options.metadata ?? metadata(),
    revisionCount: 2,
    schemaVersion: 1,
  } satisfies UpsertArticleRowInput);
}

async function writeCustomerConfig(folderPath: string): Promise<void> {
  await fs.mkdir(folderPath, { recursive: true });
  await fs.writeFile(
    path.join(folderPath, CONFIG_FILE),
    JSON.stringify({
      article: ARTICLE,
      customerName: "Acme",
      revision: REVISION,
      schemaVersion: 1,
    })
  );
}

async function writeArticleFolder(
  customerPath: string,
  folderName = ARTICLE_FOLDER_NAME,
  data: unknown = {
    CODE: folderName,
    customer: 1,
    EVO: "0",
    schemaVersion: 1,
  }
): Promise<string> {
  const articleFolderPath = path.join(customerPath, folderName);

  await fs.mkdir(articleFolderPath, { recursive: true });
  await fs.writeFile(
    path.join(articleFolderPath, ARTICLE_FILE),
    JSON.stringify(data)
  );

  return articleFolderPath;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

describe("listArticles", () => {
  it("returns an empty page for a customer without cached articles", async () => {
    await expect(
      call(listArticles, { customerFolderPath: customerFolderPath() })
    ).resolves.toEqual({ items: [], total: 0 });
  });

  it("applies the default pagination and honours limit and offset", async () => {
    for (const folderName of ["article-1", "article-2", "article-3"]) {
      seedArticle({ folderName });
    }

    const byDefault = await call(listArticles, {
      customerFolderPath: customerFolderPath(),
    });

    expect(byDefault.items).toHaveLength(3);
    expect(byDefault.total).toBe(3);

    const page = await call(listArticles, {
      customerFolderPath: customerFolderPath(),
      limit: 1,
      offset: 1,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.folderName).toBe("article-2");
    expect(page.total).toBe(3);
  });

  it("filters by customer folder path", async () => {
    seedArticle();
    seedArticle({
      customerFolderPath: customerFolderPath("0002"),
      folderName: "other",
    });

    const result = await call(listArticles, {
      customerFolderPath: customerFolderPath(),
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.customerCode).toBe(CUSTOMER_CODE);
  });

  it("searches case-insensitively across the folder name and values", async () => {
    seedArticle({
      folderName: "article-alpha",
      metadata: metadata({
        parameters: { CODE: "article-alpha", EVO: "0" },
      }),
    });
    seedArticle({
      folderName: "article-beta",
      metadata: metadata({
        customParameters: { NOTE: "Gamma" },
        parameters: { CODE: "article-beta", EVO: "0" },
      }),
    });

    const byFolder = await call(listArticles, {
      customerFolderPath: customerFolderPath(),
      search: " ALPHA ",
    });
    const byCustomValue = await call(listArticles, {
      customerFolderPath: customerFolderPath(),
      search: "gamma",
    });

    expect(byFolder.items.map((item) => item.folderName)).toEqual([
      "article-alpha",
    ]);
    expect(byCustomValue.items.map((item) => item.folderName)).toEqual([
      "article-beta",
    ]);
  });

  it("returns summaries without metadata", async () => {
    seedArticle();

    const result = await call(listArticles, {
      customerFolderPath: customerFolderPath(),
    });

    expect(result.items[0]).not.toHaveProperty("metadataJson");
    expect(result.items[0]).toMatchObject({
      activeRevision: "REV_1",
      customerCode: CUSTOMER_CODE,
      customerFolderPath: customerFolderPath(),
      folderName: ARTICLE_FOLDER_NAME,
      revisionCount: 2,
      schemaVersion: 1,
    });
  });

  it("orders results deterministically by folder name and path", async () => {
    for (const folderName of ["zeta", "alpha", "middle"]) {
      seedArticle({ folderName });
    }

    const names = (
      await call(listArticles, { customerFolderPath: customerFolderPath() })
    ).items.map((item) => item.folderName);

    expect(names).toEqual(["alpha", "middle", "zeta"]);
  });

  it("keeps total independent of limit and returns empty pages past the end", async () => {
    for (const folderName of ["article-1", "article-2"]) {
      seedArticle({ folderName });
    }

    const pastEnd = await call(listArticles, {
      customerFolderPath: customerFolderPath(),
      limit: 2,
      offset: 10,
    });

    expect(pastEnd.items).toEqual([]);
    expect(pastEnd.total).toBe(2);
  });
});

describe("getArticle", () => {
  it("returns null for a missing article", async () => {
    await expect(
      call(getArticle, {
        folderPath: path.join(customerFolderPath(), "missing"),
      })
    ).resolves.toBeNull();
  });

  it("returns the full row and typed metadata", async () => {
    const seeded = seedArticle({
      metadata: metadata({ customParameters: { FLAG: true } }),
    });

    const article = await call(getArticle, { folderPath: seeded.folderPath });

    expect(article).toMatchObject({
      activeRevision: "REV_1",
      customerCode: CUSTOMER_CODE,
      folderName: ARTICLE_FOLDER_NAME,
      revisionCount: 2,
    });
    expect(article?.metadataJson).toEqual(
      metadata({ customParameters: { FLAG: true } })
    );
    expect(typeof article?.createdAt).toBe("number");
    expect(typeof article?.updatedAt).toBe("number");
  });

  it("normalises legacy metadata to null without throwing", async () => {
    const seeded = seedArticle({
      metadata: {
        articles: 2,
        customParameters: {},
        parameters: {},
      } as unknown as ArticleCacheMetadata,
    });

    const article = await call(getArticle, { folderPath: seeded.folderPath });

    expect(article?.metadataJson).toBeNull();
    expect(article?.folderName).toBe(ARTICLE_FOLDER_NAME);
  });
});

describe("createArticle", () => {
  it("writes the data file and returns the cache row", async () => {
    const customerPath = customerFolderPath();

    await writeCustomerConfig(customerPath);

    const created = await call(createArticle, {
      customerFolderPath: customerPath,
      customParameters: { FLAG: true },
      parameters: { CODE: ARTICLE_FOLDER_NAME },
    });

    expect(created).toMatchObject({
      activeRevision: null,
      customerCode: CUSTOMER_CODE,
      folderName: ARTICLE_FOLDER_NAME,
      folderPath: path.join(customerPath, ARTICLE_FOLDER_NAME),
      revisionCount: 0,
      schemaVersion: 1,
    });
    expect(created.metadataJson).toEqual(
      metadata({
        activeRevision: null,
        customParameters: { FLAG: true },
        parameters: { CODE: ARTICLE_FOLDER_NAME, EVO: "0" },
      })
    );

    const raw = await fs.readFile(
      path.join(created.folderPath, ARTICLE_FILE),
      "utf8"
    );

    expect(JSON.parse(raw)).toMatchObject({
      CODE: ARTICLE_FOLDER_NAME,
      customer: 1,
      EVO: "0",
      FLAG: true,
      schemaVersion: 1,
    });
  });

  it("maps an existing folder to CONFLICT", async () => {
    const customerPath = customerFolderPath();

    await writeCustomerConfig(customerPath);

    const input = {
      customerFolderPath: customerPath,
      parameters: { CODE: ARTICLE_FOLDER_NAME },
    };

    await call(createArticle, input);

    await expect(call(createArticle, input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("maps a missing customer folder to NOT_FOUND", async () => {
    await expect(
      call(createArticle, {
        customerFolderPath: customerFolderPath("9999"),
        parameters: { CODE: ARTICLE_FOLDER_NAME },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maps a missing customer config to BAD_REQUEST", async () => {
    const customerPath = customerFolderPath();

    await fs.mkdir(customerPath);

    await expect(
      call(createArticle, {
        customerFolderPath: customerPath,
        parameters: { CODE: ARTICLE_FOLDER_NAME },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("maps a value the key template cannot render to BAD_REQUEST", async () => {
    const customerPath = customerFolderPath();

    await writeCustomerConfig(customerPath);

    await expect(
      call(createArticle, {
        customerFolderPath: customerPath,
        parameters: {},
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("maps an unconfigured root to PRECONDITION_FAILED", async () => {
    preferencesState.folders.articlesDirectory = null;

    await expect(
      call(createArticle, {
        customerFolderPath: customerFolderPath(),
        parameters: { CODE: ARTICLE_FOLDER_NAME },
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("updateArticle", () => {
  it("merges parameters and custom parameters and recounts revisions", async () => {
    const customerPath = customerFolderPath();

    await writeCustomerConfig(customerPath);

    const created = await call(createArticle, {
      customerFolderPath: customerPath,
      customParameters: { NOTE: "initial" },
      parameters: { CODE: ARTICLE_FOLDER_NAME },
    });

    await fs.mkdir(path.join(created.folderPath, "REV_0"));
    await fs.mkdir(path.join(created.folderPath, "REV_1"));

    const updated = await call(updateArticle, {
      customParameters: { FLAG: true },
      folderPath: created.folderPath,
    });

    expect(updated.revisionCount).toBe(2);
    expect(updated.metadataJson).toEqual(
      metadata({
        activeRevision: null,
        customParameters: { FLAG: true, NOTE: "initial" },
      })
    );

    const raw = JSON.parse(
      await fs.readFile(path.join(created.folderPath, ARTICLE_FILE), "utf8")
    ) as Record<string, unknown>;

    expect(raw).toMatchObject({
      CODE: ARTICLE_FOLDER_NAME,
      FLAG: true,
      NOTE: "initial",
    });
  });

  it("maps a key change to CONFLICT", async () => {
    const customerPath = customerFolderPath();

    await writeCustomerConfig(customerPath);

    const created = await call(createArticle, {
      customerFolderPath: customerPath,
      parameters: { CODE: ARTICLE_FOLDER_NAME },
    });

    await expect(
      call(updateArticle, {
        folderPath: created.folderPath,
        parameters: { CODE: "another-article" },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("maps a missing article to NOT_FOUND", async () => {
    await expect(
      call(updateArticle, {
        customParameters: { FLAG: true },
        folderPath: path.join(customerFolderPath(), "missing"),
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maps a missing data file to BAD_REQUEST", async () => {
    const customerPath = customerFolderPath();

    await writeCustomerConfig(customerPath);
    await fs.mkdir(path.join(customerPath, ARTICLE_FOLDER_NAME));

    await expect(
      call(updateArticle, {
        customParameters: { FLAG: true },
        folderPath: path.join(customerPath, ARTICLE_FOLDER_NAME),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("maps a path outside the root to BAD_REQUEST", async () => {
    await expect(
      call(updateArticle, {
        customParameters: { FLAG: true },
        folderPath: path.join(tempDir, "elsewhere", ARTICLE_FOLDER_NAME),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "propagates an unmapped write failure instead of an oRPC status",
    async () => {
      const customerPath = customerFolderPath();

      await writeCustomerConfig(customerPath);

      const created = await call(createArticle, {
        customerFolderPath: customerPath,
        parameters: { CODE: ARTICLE_FOLDER_NAME },
      });

      // A read-only article folder lets the revision count succeed but makes
      // the atomic data write fail with the unmapped `WRITE_FAILED` code.
      await fs.chmod(created.folderPath, 0o555);

      try {
        await expect(
          call(updateArticle, {
            customParameters: { FLAG: true },
            folderPath: created.folderPath,
          })
        ).rejects.toMatchObject({ code: "WRITE_FAILED" });
      } finally {
        await fs.chmod(created.folderPath, 0o755);
      }
    }
  );
});

describe("removeArticle", () => {
  it("moves the article to the trash and deletes its cache row", async () => {
    const customerPath = customerFolderPath();

    await writeCustomerConfig(customerPath);

    const created = await call(createArticle, {
      customerFolderPath: customerPath,
      parameters: { CODE: ARTICLE_FOLDER_NAME },
    });

    await expect(
      call(removeArticle, { folderPath: created.folderPath })
    ).resolves.toBe(created.folderPath);
    await expect(pathExists(created.folderPath)).resolves.toBe(false);
    await expect(
      pathExists(
        path.join(trashDirectory, "articles", FOLDER_NAME, ARTICLE_FOLDER_NAME)
      )
    ).resolves.toBe(true);
    await expect(
      call(getArticle, { folderPath: created.folderPath })
    ).resolves.toBeNull();
  });

  it("maps a missing article to NOT_FOUND", async () => {
    await expect(
      call(removeArticle, {
        folderPath: path.join(customerFolderPath(), "missing"),
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maps an unconfigured trash directory to PRECONDITION_FAILED", async () => {
    const customerPath = customerFolderPath();

    await writeCustomerConfig(customerPath);

    const created = await call(createArticle, {
      customerFolderPath: customerPath,
      parameters: { CODE: ARTICLE_FOLDER_NAME },
    });

    preferencesState.folders.trashDirectory = null;

    await expect(
      call(removeArticle, { folderPath: created.folderPath })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(pathExists(created.folderPath)).resolves.toBe(true);
  });
});

describe("scanArticles", () => {
  it("reports an empty result when no root is configured", async () => {
    preferencesState.folders.articlesDirectory = null;

    await expect(call(scanArticles, {})).resolves.toEqual({
      created: 0,
      issues: [],
      removed: 0,
      root: null,
      scanned: 0,
      unchanged: 0,
      updated: 0,
    });
  });

  it("reports a missing root without touching the cache", async () => {
    seedArticle();
    preferencesState.folders.articlesDirectory = path.join(
      tempDir,
      "missing-root"
    );

    const result = await call(scanArticles, {});

    expect(result.root).toBe(path.join(tempDir, "missing-root"));
    expect(result.issues.map((issue) => issue.code)).toEqual(["ROOT_MISSING"]);
    await expect(
      call(listArticles, { customerFolderPath: customerFolderPath() })
    ).resolves.toMatchObject({ total: 1 });
  });

  it("creates rows and reports them unchanged on the next run", async () => {
    const customerPath = customerFolderPath();

    await writeCustomerConfig(customerPath);
    await writeArticleFolder(customerPath);

    const first = await call(scanArticles, {});

    expect(first).toMatchObject({
      created: 1,
      removed: 0,
      root: path.resolve(articlesDirectory),
      scanned: 1,
      unchanged: 0,
      updated: 0,
    });

    const article = await call(getArticle, {
      folderPath: path.join(customerPath, ARTICLE_FOLDER_NAME),
    });

    expect(article).toMatchObject({
      customerCode: CUSTOMER_CODE,
      revisionCount: 0,
    });

    const second = await call(scanArticles, {});

    expect(second).toMatchObject({
      created: 0,
      removed: 0,
      scanned: 1,
      unchanged: 1,
      updated: 0,
    });
  });

  it("removes rows that no longer exist", async () => {
    const customerPath = customerFolderPath();

    seedArticle();
    await writeCustomerConfig(customerPath);

    const result = await call(scanArticles, {});

    expect(result.removed).toBe(1);
    await expect(
      call(listArticles, { customerFolderPath: customerPath })
    ).resolves.toEqual({ items: [], total: 0 });
  });

  it("rethrows unexpected errors as-is", async () => {
    // The mock database is intentionally missing, so the handler fails before
    // the scanner runs and `mapArticleError` must not hide the real error.
    state.db = undefined;

    await expect(call(scanArticles, {})).rejects.toThrow(
      "Database has not been initialised"
    );
  });
});

describe("clearArticles", () => {
  it("returns zero when the cache is already empty", async () => {
    await expect(call(clearArticles, undefined)).resolves.toBe(0);
  });

  it("clears only the cache and leaves the filesystem untouched", async () => {
    const customerPath = customerFolderPath();

    await writeCustomerConfig(customerPath);
    await writeArticleFolder(customerPath);
    seedArticle();

    const marker = path.join(articlesDirectory, "keep.txt");

    await fs.writeFile(marker, "keep");

    await expect(call(clearArticles, undefined)).resolves.toBe(1);
    await expect(
      call(listArticles, { customerFolderPath: customerPath })
    ).resolves.toEqual({ items: [], total: 0 });
    await expect(fs.readFile(marker, "utf8")).resolves.toBe("keep");
    await expect(
      pathExists(path.join(customerPath, ARTICLE_FOLDER_NAME))
    ).resolves.toBe(true);
  });
});
