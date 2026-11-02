// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ArticleServiceContext,
  createArticle,
  removeArticle,
  updateArticle,
} from "@/articles/crud";
import { ArticleServiceError } from "@/articles/errors";
import {
  type ArticleDatabase,
  deleteArticleRow,
  getArticleRow,
} from "@/articles/store";
import {
  type CustomerDatabase,
  getCustomerRow,
  upsertCustomerRow,
} from "@/customers/store";
import { articles, customers } from "@/db/schema";

/**
 * Lets one test simulate a failure between `mkdir` and the data write, which is
 * the only way to exercise the create rollback on a healthy filesystem. The
 * optional hook runs just before the simulated error, so a test can replace the
 * created folder with a symlink.
 */
const folderControl = vi.hoisted(() => ({
  beforeThrow: null as null | ((filePath: string) => Promise<void>),
  failWrite: false,
}));

vi.mock("@/customers/folder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/customers/folder")>();

  return {
    ...actual,
    writeJsonAtomic: async (filePath: string, value: unknown) => {
      if (folderControl.failWrite) {
        if (folderControl.beforeThrow !== null) {
          await folderControl.beforeThrow(filePath);
        }

        throw new Error("simulated write failure");
      }

      await actual.writeJsonAtomic(filePath, value);
    },
  };
});

/**
 * Lets a test make the revision counter fail after the article data was read,
 * proving the update aborts before writing.
 */
const revisionControl = vi.hoisted(() => ({ error: null as Error | null }));

vi.mock("@/articles/revisions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/articles/revisions")>();

  return {
    ...actual,
    countValidRevisions: async (
      ...args: Parameters<typeof actual.countValidRevisions>
    ) => {
      if (revisionControl.error !== null) {
        throw revisionControl.error;
      }

      return await actual.countValidRevisions(...args);
    },
  };
});

const schema = { articles, customers };

type TestDatabase = ReturnType<typeof drizzle<typeof schema>>;

const CONFIG_FILE = "customer_data.json";
const ARTICLE_FILE = "article_data.json";
const COLLISION_SUFFIX_PATTERN = /^article-1-\d+(?:-\d+)?$/u;

function validConfig(name = "Acme Srl"): Record<string, unknown> {
  return {
    article: {
      key: "{CODE}[_EVO{EVO:00}]",
      parameters: {
        CODE: { required: true, type: "text" },
        EVO: { default: "0", required: false, type: "number" },
        NOTE: { required: false, type: "text" },
      },
      schemaVersion: 1,
    },
    customerName: name,
    revision: {
      key: "REV_{REV}",
      parameters: {
        REV: { default: "0", required: false, type: "number" },
      },
      schemaVersion: 1,
    },
    schemaVersion: 1,
  };
}

/** A customer whose article key renders exactly the supplied text. */
function rawNameConfig(): Record<string, unknown> {
  return {
    article: {
      key: "{CODE}",
      parameters: { CODE: { required: true, type: "text" } },
      schemaVersion: 1,
    },
    customerName: "Raw",
    revision: {
      key: "REV_{REV}",
      parameters: { REV: { default: "0", required: false, type: "number" } },
      schemaVersion: 1,
    },
    schemaVersion: 1,
  };
}

let tempDir: string;
let root: string;
let trash: string;
let sqlite: Database.Database;
let database: TestDatabase;
let context: ArticleServiceContext;

beforeEach(async () => {
  folderControl.beforeThrow = null;
  folderControl.failWrite = false;
  revisionControl.error = null;
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "articles-crud-"));
  root = path.join(tempDir, "articles");
  trash = path.join(tempDir, "trash");

  await fs.mkdir(root);
  await fs.mkdir(trash);

  sqlite = new Database(":memory:");
  database = drizzle({ client: sqlite, schema });
  migrate(database, {
    migrationsFolder: path.resolve(import.meta.dirname, "../../../drizzle"),
  });

  context = {
    articlesDirectory: root,
    db: database as ArticleDatabase,
    trashDirectory: trash,
  };
});

afterEach(async () => {
  sqlite.close();
  await fs.rm(tempDir, { force: true, recursive: true });
});

function customerFolder(code = "0001"): string {
  return path.join(root, `customer-${code}`);
}

async function createCustomer(
  code = "0001",
  config: unknown = validConfig()
): Promise<string> {
  const folderPath = customerFolder(code);

  await fs.mkdir(folderPath, { recursive: true });
  await fs.writeFile(
    path.join(folderPath, CONFIG_FILE),
    typeof config === "string" ? config : JSON.stringify(config)
  );

  return folderPath;
}

/** Seeds the customer cache row the article mutations refresh. */
function seedCustomerRow(folderPath: string, articleCount: number): void {
  upsertCustomerRow(database as CustomerDatabase, {
    articleSchemaVersion: 1,
    customerCode: "0001",
    folderMtimeMs: Date.now(),
    folderName: path.basename(folderPath),
    folderPath,
    issues: [],
    metadata: {
      article: null,
      articleCount,
      issues: [],
      revision: null,
    },
    name: "Acme Srl",
    revisionSchemaVersion: 1,
    schemaVersion: 1,
    status: "ok",
  });
}

function cachedArticleCount(folderPath: string): number | undefined {
  const row = getCustomerRow(database as CustomerDatabase, folderPath);
  const metadata = row?.metadataJson as { articleCount?: number } | undefined;

  return metadata?.articleCount;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);

    return true;
  } catch {
    return false;
  }
}

async function readArticleData(
  articleFolderPath: string
): Promise<Record<string, unknown>> {
  return JSON.parse(
    await fs.readFile(path.join(articleFolderPath, ARTICLE_FILE), "utf8")
  ) as Record<string, unknown>;
}

async function writeArticleData(
  articleFolderPath: string,
  value: unknown
): Promise<void> {
  await fs.writeFile(
    path.join(articleFolderPath, ARTICLE_FILE),
    typeof value === "string" ? value : JSON.stringify(value)
  );
}

function createArticleInput(
  customerFolderPath: string,
  overrides: {
    customParameters?: Record<string, unknown>;
    parameters?: Record<string, string | number | boolean | null | undefined>;
  } = {}
) {
  return {
    customerFolderPath,
    parameters: overrides.parameters ?? { CODE: "article-1" },
    ...(overrides.customParameters === undefined
      ? {}
      : { customParameters: overrides.customParameters }),
  };
}

async function createDefaultArticle(
  customerFolderPath: string,
  overrides: {
    customParameters?: Record<string, unknown>;
    parameters?: Record<string, string | number | boolean | null | undefined>;
  } = {}
): Promise<string> {
  const record = await createArticle(
    context,
    createArticleInput(customerFolderPath, overrides)
  );

  return record.folderPath;
}

describe("createArticle", () => {
  it("creates the folder and canonical article_data.json and caches the row", async () => {
    const customer = await createCustomer();

    const record = await createArticle(context, {
      customerFolderPath: customer,
      parameters: { CODE: "article-example-1" },
    });

    expect(record).toMatchObject({
      activeRevision: null,
      customerCode: "0001",
      customerFolderPath: customer,
      folderName: "article-example-1",
      folderPath: path.join(customer, "article-example-1"),
      revisionCount: 0,
      schemaVersion: 1,
    });
    expect(record.metadataJson).toEqual({
      activeRevision: null,
      customer: 1,
      customParameters: {},
      parameters: { CODE: "article-example-1", EVO: "0", NOTE: "" },
      schemaVersion: 1,
    });

    expect((await fs.lstat(record.folderPath)).isDirectory()).toBe(true);
    expect(await readArticleData(record.folderPath)).toEqual({
      CODE: "article-example-1",
      customer: 1,
      EVO: "0",
      NOTE: "",
      schemaVersion: 1,
    });
    expect(
      getArticleRow(database as ArticleDatabase, record.folderPath)
    ).toMatchObject({
      folderName: "article-example-1",
      revisionCount: 0,
    });
  });

  it("refreshes the cached customer article count", async () => {
    const customer = await createCustomer();
    seedCustomerRow(customer, 0);

    await createArticle(context, {
      customerFolderPath: customer,
      parameters: { CODE: "article-1" },
    });

    expect(cachedArticleCount(customer)).toBe(1);
  });

  it("writes and caches custom parameters", async () => {
    const customer = await createCustomer();

    const record = await createArticle(
      context,
      createArticleInput(customer, {
        customParameters: { CUSTOM: "value", FLAG: true, NUM: 3 },
      })
    );

    expect(await readArticleData(record.folderPath)).toMatchObject({
      CUSTOM: "value",
      FLAG: true,
      NUM: 3,
    });
    expect(record.metadataJson).toMatchObject({
      customParameters: { CUSTOM: "value", FLAG: true, NUM: 3 },
    });
    expect(record.searchText).toContain("value true 3");
  });

  it("renders the optional group and padded parameter in the folder name", async () => {
    const customer = await createCustomer();

    const record = await createArticle(
      context,
      createArticleInput(customer, {
        parameters: { CODE: "article-1", EVO: "5" },
      })
    );

    expect(record.folderName).toBe("article-1_EVO05");
    expect(record.folderPath).toBe(path.join(customer, "article-1_EVO05"));
  });

  it("rejects a missing required parameter", async () => {
    const customer = await createCustomer();

    await expect(
      createArticle(context, {
        customerFolderPath: customer,
        parameters: {},
      })
    ).rejects.toMatchObject({ code: "KEY_RENDER_INVALID" });
    expect(await pathExists(path.join(customer, "article-1"))).toBe(false);
  });

  it("rejects an article that already exists", async () => {
    const customer = await createCustomer();

    await createDefaultArticle(customer);

    await expect(
      createArticle(context, createArticleInput(customer))
    ).rejects.toMatchObject({ code: "ARTICLE_ALREADY_EXISTS" });
  });

  it("reports a missing customer config", async () => {
    const customer = customerFolder("0001");

    await fs.mkdir(customer, { recursive: true });

    await expect(
      createArticle(context, createArticleInput(customer))
    ).rejects.toMatchObject({ code: "ARTICLE_CUSTOMER_CONFIG_MISSING" });
    expect(await pathExists(path.join(customer, "article-1"))).toBe(false);
  });

  it("reports an invalid customer config", async () => {
    const customer = await createCustomer("0001", "{not json");

    await expect(
      createArticle(context, createArticleInput(customer))
    ).rejects.toMatchObject({ code: "ARTICLE_CUSTOMER_CONFIG_INVALID" });
  });

  it("rejects a dot-prefixed rendered folder name", async () => {
    const customer = await createCustomer("0001", rawNameConfig());

    await expect(
      createArticle(context, {
        customerFolderPath: customer,
        parameters: { CODE: ".hidden" },
      })
    ).rejects.toMatchObject({ code: "ARTICLE_FOLDER_NAME_INVALID" });
    expect(await pathExists(path.join(customer, ".hidden"))).toBe(false);
  });

  it("rejects parameters that are not declared by the customer", async () => {
    const customer = await createCustomer();

    await expect(
      createArticle(context, {
        customerFolderPath: customer,
        parameters: { CODE: "article-1", EVOO: "1" },
      })
    ).rejects.toMatchObject({ code: "ARTICLE_DATA_INVALID" });
    expect(await pathExists(path.join(customer, "article-1"))).toBe(false);
  });

  it("rejects a document that would exceed the data size limit", async () => {
    const customer = await createCustomer();
    const customParameters: Record<string, string> = {};

    for (let index = 0; index < 64; index += 1) {
      customParameters[`CUSTOM_${index}`] = "x".repeat(1024);
    }

    await expect(
      createArticle(context, createArticleInput(customer, { customParameters }))
    ).rejects.toMatchObject({ code: "ARTICLE_DATA_INVALID" });
    expect(await pathExists(path.join(customer, "article-1"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "does not remove a folder that was replaced by a symlink on write failure",
    async () => {
      const customer = await createCustomer();
      const target = path.join(tempDir, "rollback-target");

      await fs.mkdir(target);
      await fs.writeFile(path.join(target, "keep.txt"), "keep");
      folderControl.failWrite = true;
      folderControl.beforeThrow = async () => {
        const articleFolder = path.join(customer, "article-1");

        await fs.rm(articleFolder, { force: true, recursive: true });
        await fs.symlink(target, articleFolder, "dir");
      };

      try {
        await expect(
          createArticle(context, createArticleInput(customer))
        ).rejects.toMatchObject({ code: "WRITE_FAILED" });
      } finally {
        folderControl.failWrite = false;
        folderControl.beforeThrow = null;
      }

      expect(await pathExists(path.join(target, "keep.txt"))).toBe(true);
    }
  );

  it("rejects reserved and colliding custom parameter names", async () => {
    const customer = await createCustomer();

    for (const name of [
      "schemaVersion",
      "customer",
      "activeRevision",
      "CODE",
      "EVO",
      "NOTE",
    ]) {
      // biome-ignore lint/performance/noAwaitInLoops: each name is checked against the same fresh input.
      await expect(
        createArticle(
          context,
          createArticleInput(customer, {
            customParameters: { [name]: "value" },
          })
        )
      ).rejects.toMatchObject({ code: "ARTICLE_DATA_INVALID" });
    }

    expect(await pathExists(path.join(customer, "article-1"))).toBe(false);
  });

  it("rejects invalid custom parameter values and names", async () => {
    const customer = await createCustomer();
    const invalidValues: unknown[] = [
      null,
      [],
      {},
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "x".repeat(1025),
    ];

    for (const value of invalidValues) {
      // biome-ignore lint/performance/noAwaitInLoops: each value is checked against the same fresh input.
      await expect(
        createArticle(
          context,
          createArticleInput(customer, { customParameters: { CUSTOM: value } })
        )
      ).rejects.toMatchObject({ code: "ARTICLE_DATA_INVALID" });
    }

    await expect(
      createArticle(
        context,
        createArticleInput(customer, {
          customParameters: { lower: "value" },
        })
      )
    ).rejects.toMatchObject({ code: "ARTICLE_DATA_INVALID" });
  });

  it("removes the new folder when the data write fails", async () => {
    const customer = await createCustomer();

    folderControl.failWrite = true;

    try {
      await expect(
        createArticle(context, createArticleInput(customer))
      ).rejects.toThrow("simulated write failure");
    } finally {
      folderControl.failWrite = false;
    }

    expect(await pathExists(path.join(customer, "article-1"))).toBe(false);
    expect(
      getArticleRow(
        database as ArticleDatabase,
        path.join(customer, "article-1")
      )
    ).toBeNull();
  });
});

describe("createArticle path and root guards", () => {
  it("rejects a customer folder outside the articles directory", async () => {
    await expect(
      createArticle(context, {
        customerFolderPath: path.join(tempDir, "elsewhere"),
        parameters: { CODE: "article-1" },
      })
    ).rejects.toMatchObject({ code: "ARTICLE_PATH_INVALID" });
  });

  it("rejects a nested customer folder", async () => {
    const customer = await createCustomer();

    await expect(
      createArticle(context, {
        customerFolderPath: path.join(customer, "nested"),
        parameters: { CODE: "article-1" },
      })
    ).rejects.toMatchObject({ code: "ARTICLE_PATH_INVALID" });
  });

  it("reports a customer folder that is not a directory", async () => {
    const filePath = customerFolder("0001");

    await fs.writeFile(filePath, "not a directory");

    await expect(
      createArticle(context, {
        customerFolderPath: filePath,
        parameters: { CODE: "article-1" },
      })
    ).rejects.toMatchObject({ code: "ARTICLE_CUSTOMER_NOT_DIRECTORY" });
  });

  it.skipIf(process.platform === "win32")(
    "reports a symlinked customer folder",
    async () => {
      const target = path.join(tempDir, "real-customer");
      const linkPath = customerFolder("0001");

      await fs.mkdir(target);
      await fs.writeFile(
        path.join(target, CONFIG_FILE),
        JSON.stringify(validConfig())
      );
      await fs.symlink(target, linkPath, "dir");

      await expect(
        createArticle(context, {
          customerFolderPath: linkPath,
          parameters: { CODE: "article-1" },
        })
      ).rejects.toMatchObject({ code: "ARTICLE_CUSTOMER_SYMLINK" });
    }
  );

  it("maps root failures onto article codes", async () => {
    const missing = path.join(tempDir, "missing-root");
    const fileRoot = path.join(tempDir, "root-file");

    await fs.writeFile(fileRoot, "not a directory");

    await expect(
      createArticle(
        { ...context, articlesDirectory: null },
        {
          customerFolderPath: customerFolder("0001"),
          parameters: { CODE: "a" },
        }
      )
    ).rejects.toMatchObject({ code: "ROOT_NOT_CONFIGURED" });
    await expect(
      createArticle(
        { ...context, articlesDirectory: missing },
        {
          customerFolderPath: path.join(missing, "customer-0001"),
          parameters: { CODE: "a" },
        }
      )
    ).rejects.toMatchObject({ code: "ROOT_NOT_FOUND" });
    await expect(
      createArticle(
        { ...context, articlesDirectory: fileRoot },
        {
          customerFolderPath: path.join(fileRoot, "customer-0001"),
          parameters: { CODE: "a" },
        }
      )
    ).rejects.toMatchObject({ code: "ROOT_NOT_DIRECTORY" });
  });

  it.skipIf(process.platform === "win32")(
    "reports a symlinked root",
    async () => {
      const target = path.join(tempDir, "real-root");
      const linkRoot = path.join(tempDir, "root-link");

      await fs.mkdir(target);
      await fs.symlink(target, linkRoot, "dir");

      await expect(
        createArticle(
          { ...context, articlesDirectory: linkRoot },
          {
            customerFolderPath: path.join(linkRoot, "customer-0001"),
            parameters: { CODE: "a" },
          }
        )
      ).rejects.toMatchObject({ code: "ROOT_SYMLINK" });
    }
  );
});

describe("updateArticle", () => {
  it("updates a declared parameter without changing the folder name", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer, {
      parameters: { CODE: "article-1", NOTE: "one" },
    });

    const record = await updateArticle(context, {
      folderPath: articlePath,
      parameters: { NOTE: "two" },
    });

    expect(record.folderName).toBe("article-1");
    expect(record.metadataJson).toMatchObject({
      parameters: { CODE: "article-1", EVO: "0", NOTE: "two" },
    });
    expect(await readArticleData(articlePath)).toMatchObject({ NOTE: "two" });
  });

  it("refuses an update that would change the rendered key", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer);

    await expect(
      updateArticle(context, {
        folderPath: articlePath,
        parameters: { CODE: "other" },
      })
    ).rejects.toMatchObject({
      code: "ARTICLE_KEY_LOCKED",
      message: expect.stringContaining("article-1"),
    });
    expect(await readArticleData(articlePath)).toMatchObject({
      CODE: "article-1",
    });
  });

  it("rejects undeclared parameter names", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer);

    await expect(
      updateArticle(context, {
        folderPath: articlePath,
        parameters: { NOTE: "kept", UNKNOWN: "value" },
      })
    ).rejects.toMatchObject({ code: "ARTICLE_DATA_INVALID" });
    expect(await readArticleData(articlePath)).toMatchObject({ NOTE: "" });
  });

  it("allows a custom-parameter-only update on a renamed folder", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer);
    const renamedPath = path.join(customer, "renamed-on-disk");

    await fs.rename(articlePath, renamedPath);

    const record = await updateArticle(context, {
      customParameters: { A: "1" },
      folderPath: renamedPath,
    });

    expect(record.folderName).toBe("renamed-on-disk");
    expect(record.metadataJson).toMatchObject({
      customParameters: { A: "1" },
    });
    expect(await readArticleData(renamedPath)).toMatchObject({ A: "1" });
  });

  it("still locks a parameter update on a renamed folder", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer);
    const renamedPath = path.join(customer, "renamed-on-disk");

    await fs.rename(articlePath, renamedPath);

    await expect(
      updateArticle(context, {
        folderPath: renamedPath,
        parameters: { NOTE: "kept" },
      })
    ).rejects.toMatchObject({ code: "ARTICLE_KEY_LOCKED" });
  });

  it("aborts before writing when the revision count fails", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer);

    revisionControl.error = new ArticleServiceError(
      "READ_FAILED",
      "simulated revision read failure"
    );

    await expect(
      updateArticle(context, {
        folderPath: articlePath,
        parameters: { NOTE: "lost" },
      })
    ).rejects.toMatchObject({ code: "READ_FAILED" });
    expect(await readArticleData(articlePath)).toMatchObject({ NOTE: "" });
  });

  it("wraps a non-article revision failure as ARTICLE_DATA_UNREADABLE", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer);

    revisionControl.error = new Error("unexpected revision failure");

    await expect(
      updateArticle(context, {
        folderPath: articlePath,
        parameters: { NOTE: "lost" },
      })
    ).rejects.toMatchObject({ code: "ARTICLE_DATA_UNREADABLE" });
    expect(await readArticleData(articlePath)).toMatchObject({ NOTE: "" });
  });

  it("rejects merged custom parameters above the maximum", async () => {
    const customer = await createCustomer();
    const initial: Record<string, unknown> = {};

    for (let index = 0; index < 40; index += 1) {
      initial[`K${index}`] = "x";
    }

    const articlePath = await createDefaultArticle(customer, {
      customParameters: initial,
    });
    const added: Record<string, unknown> = {};

    for (let index = 40; index <= 64; index += 1) {
      added[`K${index}`] = "x";
    }

    await expect(
      updateArticle(context, {
        customParameters: added,
        folderPath: articlePath,
      })
    ).rejects.toMatchObject({ code: "ARTICLE_DATA_INVALID" });
  });

  it("merges custom parameters, replacing values but never deleting keys", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer, {
      customParameters: { A: "1" },
    });

    const withB = await updateArticle(context, {
      customParameters: { B: "2" },
      folderPath: articlePath,
    });

    expect(withB.metadataJson).toMatchObject({
      customParameters: { A: "1", B: "2" },
    });

    const replaced = await updateArticle(context, {
      customParameters: { A: "3" },
      folderPath: articlePath,
    });

    expect(replaced.metadataJson).toMatchObject({
      customParameters: { A: "3", B: "2" },
    });
    expect(await readArticleData(articlePath)).toMatchObject({
      A: "3",
      B: "2",
    });
  });

  it("rejects reserved, colliding and invalid custom parameters", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer);

    for (const customParameters of [
      { schemaVersion: "1" },
      { customer: "1" },
      { activeRevision: "x" },
      { CODE: "x" },
      { lower: "x" },
      { CUSTOM: null },
      { CUSTOM: Number.NaN },
    ]) {
      // biome-ignore lint/performance/noAwaitInLoops: each input is checked against the same article.
      await expect(
        updateArticle(context, { customParameters, folderPath: articlePath })
      ).rejects.toMatchObject({ code: "ARTICLE_DATA_INVALID" });
    }

    expect(await readArticleData(articlePath)).toMatchObject({
      CODE: "article-1",
    });
  });

  it("preserves the active revision and the existing schema version", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer);

    await writeArticleData(articlePath, {
      activeRevision: "REV_1",
      CODE: "article-1",
      customer: 1,
      schemaVersion: 2,
    });

    const record = await updateArticle(context, {
      folderPath: articlePath,
      parameters: { NOTE: "kept" },
    });

    expect(record.activeRevision).toBe("REV_1");
    expect(record.schemaVersion).toBe(2);
    expect(await readArticleData(articlePath)).toMatchObject({
      activeRevision: "REV_1",
      schemaVersion: 2,
    });
  });

  it("recounts the revisions after the update", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer);

    await fs.mkdir(path.join(articlePath, "REV_0"));
    await fs.mkdir(path.join(articlePath, "REV_1"));

    const record = await updateArticle(context, {
      folderPath: articlePath,
      parameters: { NOTE: "counted" },
    });

    expect(record.revisionCount).toBe(2);
  });

  it("reports a write failure without changing the data file", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer);

    folderControl.failWrite = true;

    try {
      await expect(
        updateArticle(context, {
          folderPath: articlePath,
          parameters: { NOTE: "lost" },
        })
      ).rejects.toMatchObject({
        code: "WRITE_FAILED",
        message: "simulated write failure",
      });
    } finally {
      folderControl.failWrite = false;
    }

    expect(await readArticleData(articlePath)).toMatchObject({ NOTE: "" });
  });

  it("reports a missing article", async () => {
    const customer = await createCustomer();

    await expect(
      updateArticle(context, {
        folderPath: path.join(customer, "missing"),
        parameters: { NOTE: "x" },
      })
    ).rejects.toMatchObject({ code: "ARTICLE_NOT_FOUND" });
  });

  it("reports a missing or invalid customer config", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer);
    const configPath = path.join(customer, CONFIG_FILE);

    await fs.rm(configPath);
    await expect(
      updateArticle(context, { folderPath: articlePath })
    ).rejects.toMatchObject({ code: "ARTICLE_CUSTOMER_CONFIG_MISSING" });

    await fs.writeFile(configPath, "{not json");
    await expect(
      updateArticle(context, { folderPath: articlePath })
    ).rejects.toMatchObject({ code: "ARTICLE_CUSTOMER_CONFIG_INVALID" });
  });

  it("propagates invalid article data", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer);
    const dataPath = path.join(articlePath, ARTICLE_FILE);

    await writeArticleData(articlePath, "{not json");
    await expect(
      updateArticle(context, { folderPath: articlePath })
    ).rejects.toMatchObject({ code: "ARTICLE_DATA_INVALID_JSON" });

    await writeArticleData(articlePath, {
      CODE: "article-1",
      customer: 2,
      schemaVersion: 1,
    });
    await expect(
      updateArticle(context, { folderPath: articlePath })
    ).rejects.toMatchObject({ code: "ARTICLE_DATA_INVALID" });

    await fs.rm(dataPath);
    await expect(
      updateArticle(context, { folderPath: articlePath })
    ).rejects.toMatchObject({ code: "ARTICLE_DATA_MISSING" });
  });

  it("rejects an article path outside the articles directory", async () => {
    await expect(
      updateArticle(context, {
        folderPath: path.join(tempDir, "elsewhere", "article-1"),
      })
    ).rejects.toMatchObject({ code: "ARTICLE_PATH_INVALID" });
  });

  it("reports an article folder that is a file", async () => {
    const customer = await createCustomer();
    const articlePath = path.join(customer, "article-1");

    await fs.writeFile(articlePath, "not a directory");

    await expect(
      updateArticle(context, { folderPath: articlePath })
    ).rejects.toMatchObject({ code: "ARTICLE_FOLDER_NOT_DIRECTORY" });
  });

  it.skipIf(process.platform === "win32")(
    "reports a symlinked article folder",
    async () => {
      const customer = await createCustomer();
      const target = path.join(tempDir, "real-article");
      const linkPath = path.join(customer, "article-1");

      await fs.mkdir(target);
      await fs.writeFile(
        path.join(target, ARTICLE_FILE),
        JSON.stringify({ CODE: "article-1", customer: 1, schemaVersion: 1 })
      );
      await fs.symlink(target, linkPath, "dir");

      await expect(
        updateArticle(context, { folderPath: linkPath })
      ).rejects.toMatchObject({ code: "ARTICLE_FOLDER_SYMLINK" });
    }
  );
});

describe("removeArticle", () => {
  it("moves the article under <trash>/articles/<customer> and deletes the row", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer);

    await expect(
      removeArticle(context, { folderPath: articlePath })
    ).resolves.toBe(articlePath);

    const trashed = path.join(trash, "articles", "customer-0001", "article-1");

    expect(await pathExists(articlePath)).toBe(false);
    expect(await pathExists(trashed)).toBe(true);
    expect(await readArticleData(trashed)).toMatchObject({ CODE: "article-1" });
    expect(getArticleRow(database as ArticleDatabase, articlePath)).toBeNull();
  });

  it("refreshes the cached customer article count", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer);
    seedCustomerRow(customer, 1);

    await removeArticle(context, { folderPath: articlePath });

    expect(cachedArticleCount(customer)).toBe(0);
  });

  it("adds a collision suffix when the trash destination already exists", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer);
    const original = path.join(trash, "articles", "customer-0001", "article-1");

    await fs.mkdir(original, { recursive: true });

    await removeArticle(context, { folderPath: articlePath });

    const entries = await fs.readdir(
      path.join(trash, "articles", "customer-0001")
    );
    const suffixed = entries.filter((entry) =>
      COLLISION_SUFFIX_PATTERN.test(entry)
    );

    expect(entries).toContain("article-1");
    expect(suffixed).toHaveLength(1);
    expect(await pathExists(articlePath)).toBe(false);
  });

  it("requires a configured trash directory", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer);

    await expect(
      removeArticle(
        { ...context, trashDirectory: null },
        { folderPath: articlePath }
      )
    ).rejects.toMatchObject({ code: "TRASH_NOT_CONFIGURED" });
    expect(await pathExists(articlePath)).toBe(true);
  });

  it("reports a missing trash directory", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer);

    await expect(
      removeArticle(
        { ...context, trashDirectory: path.join(tempDir, "missing-trash") },
        { folderPath: articlePath }
      )
    ).rejects.toMatchObject({ code: "TRASH_NOT_FOUND" });
    expect(await pathExists(articlePath)).toBe(true);
  });

  it("reports a trash directory that is a file", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer);
    const trashFile = path.join(tempDir, "trash-file");

    await fs.writeFile(trashFile, "not a directory");

    await expect(
      removeArticle(
        { ...context, trashDirectory: trashFile },
        { folderPath: articlePath }
      )
    ).rejects.toMatchObject({ code: "TRASH_NOT_DIRECTORY" });
  });

  it.skipIf(process.platform === "win32")(
    "reports a symlinked trash directory",
    async () => {
      const customer = await createCustomer();
      const articlePath = await createDefaultArticle(customer);
      const realTrash = path.join(tempDir, "real-trash");
      const linkTrash = path.join(tempDir, "trash-link");

      await fs.mkdir(realTrash);
      await fs.symlink(realTrash, linkTrash, "dir");

      await expect(
        removeArticle(
          { ...context, trashDirectory: linkTrash },
          { folderPath: articlePath }
        )
      ).rejects.toMatchObject({ code: "TRASH_SYMLINK" });
      expect(await pathExists(articlePath)).toBe(true);
    }
  );

  it("refuses a trash directory inside the articles directory", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer);
    const nestedTrash = path.join(root, "trash");

    await fs.mkdir(nestedTrash);

    await expect(
      removeArticle(
        { ...context, trashDirectory: nestedTrash },
        { folderPath: articlePath }
      )
    ).rejects.toMatchObject({ code: "INVALID_OPERATION" });
    expect(await pathExists(articlePath)).toBe(true);
  });

  it("refuses an ancestor trash directory that resolves back into the root", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer);

    // `root` basename is "articles", so <trash>/articles/<customer> resolves
    // back inside the root and the move would become an in-place rename.
    await expect(
      removeArticle(
        { ...context, trashDirectory: path.dirname(root) },
        { folderPath: articlePath }
      )
    ).rejects.toMatchObject({ code: "INVALID_OPERATION" });
    expect(await pathExists(articlePath)).toBe(true);
    expect(await pathExists(path.join(root, "articles"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "refuses a trash directory that resolves inside the root through a symlink",
    async () => {
      const customer = await createCustomer();
      const articlePath = await createDefaultArticle(customer);
      const insideTrash = path.join(root, "internal-trash", "nested");
      const link = path.join(tempDir, "trash-link");

      await fs.mkdir(insideTrash, { recursive: true });
      await fs.symlink(path.join(root, "internal-trash"), link, "dir");

      await expect(
        removeArticle(
          { ...context, trashDirectory: path.join(link, "nested") },
          { folderPath: articlePath }
        )
      ).rejects.toMatchObject({ code: "INVALID_OPERATION" });
      expect(await pathExists(articlePath)).toBe(true);
    }
  );

  it("removes the folder even when the config or cache row is gone", async () => {
    const customer = await createCustomer();
    const articlePath = await createDefaultArticle(customer);

    await fs.rm(path.join(customer, CONFIG_FILE));
    deleteArticleRow(database as ArticleDatabase, articlePath);

    await expect(
      removeArticle(context, { folderPath: articlePath })
    ).resolves.toBe(articlePath);
    expect(
      await pathExists(
        path.join(trash, "articles", "customer-0001", "article-1")
      )
    ).toBe(true);
  });

  it("reports a missing article", async () => {
    const customer = await createCustomer();

    await expect(
      removeArticle(context, { folderPath: path.join(customer, "missing") })
    ).rejects.toMatchObject({ code: "ARTICLE_NOT_FOUND" });
  });

  it("reports an article folder that is a file", async () => {
    const customer = await createCustomer();
    const articlePath = path.join(customer, "article-1");

    await fs.writeFile(articlePath, "not a directory");

    await expect(
      removeArticle(context, { folderPath: articlePath })
    ).rejects.toMatchObject({ code: "ARTICLE_FOLDER_NOT_DIRECTORY" });
  });

  it.skipIf(process.platform === "win32")(
    "reports a symlinked article folder",
    async () => {
      const customer = await createCustomer();
      const target = path.join(tempDir, "real-article");
      const linkPath = path.join(customer, "article-1");

      await fs.mkdir(target);
      await fs.symlink(target, linkPath, "dir");

      await expect(
        removeArticle(context, { folderPath: linkPath })
      ).rejects.toMatchObject({ code: "ARTICLE_FOLDER_SYMLINK" });
      expect(await pathExists(target)).toBe(true);
    }
  );

  it("rejects an article path outside the articles directory", async () => {
    await expect(
      removeArticle(context, {
        folderPath: path.join(tempDir, "elsewhere", "article-1"),
      })
    ).rejects.toMatchObject({ code: "ARTICLE_PATH_INVALID" });
  });
});
