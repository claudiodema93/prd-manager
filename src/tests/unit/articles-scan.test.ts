// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { articleIssue, scanArticles } from "@/articles/scan";
import {
  type ArticleDatabase,
  getArticleRow,
  listArticleRows,
  upsertArticleRow,
} from "@/articles/store";
import {
  type ArticleScanResult,
  MAX_ARTICLE_ISSUE_MESSAGE_LENGTH,
} from "@/articles/types";
import { countValidArticles } from "@/customers/folder";
import { articles, customers } from "@/db/schema";

/**
 * Lets one test force the revision counter to fail, which is the only way to
 * exercise the "never cache an unknown revision count as 0" branch on a healthy
 * filesystem. Every other call delegates to the real implementation.
 */
const revisionControl = vi.hoisted(() => ({
  mode: "none" as "budget" | "generic" | "none",
}));

vi.mock("@/articles/revisions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/articles/revisions")>();

  return {
    ...actual,
    countValidRevisions: async (
      ...args: Parameters<typeof actual.countValidRevisions>
    ) => {
      if (revisionControl.mode === "budget") {
        throw new actual.RevisionMatchBudgetError(
          "simulated revision matcher budget exhaustion"
        );
      }

      if (revisionControl.mode === "generic") {
        throw new Error("simulated revision read failure");
      }

      return await actual.countValidRevisions(...args);
    },
  };
});

const schema = { articles, customers };

type TestDatabase = ReturnType<typeof drizzle<typeof schema>>;

const CONFIG_FILE = "customer_data.json";
const ARTICLE_FILE = "article_data.json";
const TRUNCATION_MESSAGE_PATTERN = /only the first 199/u;

function validConfig(name = "Acme Srl"): Record<string, unknown> {
  return {
    article: {
      key: "{CODE}[_EVO{EVO:00}]",
      parameters: {
        CODE: { required: true, type: "text" },
        EVO: { default: "0", required: false, type: "number" },
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

/** Same definition, but the revision key requires zero padding. */
function paddedRevisionConfig(name = "Padded Srl"): Record<string, unknown> {
  const config = validConfig(name);

  config.revision = {
    key: "REV-{REV:00}",
    parameters: {
      REV: { default: "0", required: false, type: "number" },
    },
    schemaVersion: 1,
  };

  return config;
}

function emptyMetadata(parameters: Record<string, string> = {}) {
  return {
    activeRevision: null,
    customer: 1,
    customParameters: {},
    parameters,
    schemaVersion: 1,
  };
}

function insertRow(articleFolderPath: string): void {
  const customerFolderPath = path.dirname(articleFolderPath);

  upsertArticleRow(db, {
    activeRevision: null,
    customerCode: path.basename(customerFolderPath).slice("customer-".length),
    customerFolderPath,
    folderMtimeMs: 1,
    folderName: path.basename(articleFolderPath),
    folderPath: articleFolderPath,
    metadata: emptyMetadata(),
    revisionCount: 0,
    schemaVersion: 1,
  });
}

function issueCodes(result: ArticleScanResult): string[] {
  return result.issues.map((issue) => issue.code);
}

let sqlite: Database.Database;
let db: ArticleDatabase;
let root: string;
let tempDirs: string[];

async function makeTempDir(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));

  tempDirs.push(directory);

  return directory;
}

beforeEach(async () => {
  revisionControl.mode = "none";
  sqlite = new Database(":memory:");
  const database: TestDatabase = drizzle({ client: sqlite, schema });

  migrate(database, {
    migrationsFolder: path.resolve(import.meta.dirname, "../../../drizzle"),
  });

  db = database as ArticleDatabase;
  tempDirs = [];
  root = await makeTempDir("articles-scan-");
});

afterEach(async () => {
  sqlite.close();

  await Promise.all(
    tempDirs.map((directory) =>
      fs.rm(directory, { force: true, recursive: true })
    )
  );

  tempDirs = [];
});

async function createCustomerFolder(
  name: string,
  config: unknown = validConfig()
): Promise<string> {
  const folderPath = path.join(root, name);

  await fs.mkdir(folderPath, { recursive: true });
  await fs.writeFile(
    path.join(folderPath, CONFIG_FILE),
    typeof config === "string" ? config : JSON.stringify(config)
  );

  return folderPath;
}

async function writeArticle(
  customerFolderPath: string,
  name: string,
  value: unknown,
  revisions: readonly string[] = []
): Promise<string> {
  const articlePath = path.join(customerFolderPath, name);

  await fs.mkdir(articlePath, { recursive: true });
  await fs.writeFile(
    path.join(articlePath, ARTICLE_FILE),
    typeof value === "string" ? value : JSON.stringify(value)
  );

  for (const revision of revisions) {
    // biome-ignore lint/performance/noAwaitInLoops: the fixture is intentionally sequential.
    await fs.mkdir(path.join(articlePath, revision));
  }

  return articlePath;
}

function scan(
  rootDirectory: string | null,
  maxRootEntries?: number,
  maxCustomerEntries?: number
) {
  return scanArticles({
    db,
    rootDirectory,
    ...(maxRootEntries === undefined ? {} : { maxRootEntries }),
    ...(maxCustomerEntries === undefined ? {} : { maxCustomerEntries }),
  });
}

describe("articleIssue", () => {
  it("keeps a bounded path", () => {
    expect(
      articleIssue("ROOT_UNREADABLE", "error", "message", "/short/path").path
    ).toBe("/short/path");
  });

  it("keeps a path exactly at the wire limit", () => {
    const boundaryPath = "x".repeat(4096);

    expect(
      articleIssue("ROOT_UNREADABLE", "error", "message", boundaryPath).path
    ).toBe(boundaryPath);
  });

  it("omits a path that would violate the wire schema", () => {
    const issue = articleIssue(
      "ROOT_UNREADABLE",
      "error",
      "message",
      "x".repeat(4097)
    );

    expect(issue).not.toHaveProperty("path");
  });

  it("truncates an over-long message with an ellipsis", () => {
    const issue = articleIssue(
      "ROOT_UNREADABLE",
      "error",
      "x".repeat(MAX_ARTICLE_ISSUE_MESSAGE_LENGTH + 10)
    );

    expect(issue.message).toHaveLength(MAX_ARTICLE_ISSUE_MESSAGE_LENGTH);
    expect(issue.message.endsWith("…")).toBe(true);
  });
});

describe("root handling", () => {
  it("returns an empty result and leaves the cache alone when the root is not configured", async () => {
    const articlePath = path.join(root, "customer-0001", "article-1");

    insertRow(articlePath);

    const result = await scan(null);

    expect(result).toEqual({
      created: 0,
      issues: [],
      removed: 0,
      root: null,
      scanned: 0,
      unchanged: 0,
      updated: 0,
    });
    expect(listArticleRows(db)).toHaveLength(1);
  });

  it("reports a missing root without deleting existing rows", async () => {
    const missingRoot = path.join(root, "missing-root");
    const articlePath = path.join(missingRoot, "customer-0001", "article-1");

    insertRow(articlePath);

    const result = await scan(missingRoot);

    expect(result).toMatchObject({
      created: 0,
      removed: 0,
      root: missingRoot,
      scanned: 0,
      unchanged: 0,
      updated: 0,
    });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: "ROOT_MISSING",
      path: missingRoot,
      severity: "error",
    });
    expect(getArticleRow(db, articlePath)).not.toBeNull();
  });

  it("reports a root that is not a directory", async () => {
    const fileRoot = path.join(root, "not-a-directory");

    await fs.writeFile(fileRoot, "hello");

    const result = await scan(fileRoot);

    expect(result.issues[0]).toMatchObject({
      code: "ROOT_NOT_DIRECTORY",
      path: fileRoot,
      severity: "error",
    });
  });

  it("rejects a root containing a NUL character", async () => {
    const unresolved = `${root}/nested/..\0invalid`;
    const result = await scan(unresolved);

    expect(result.issues[0]).toMatchObject({
      code: "ROOT_UNREADABLE",
      severity: "error",
    });
    // Reported without being normalised through path.resolve.
    expect(result.root).toBe(unresolved);
  });

  it.skipIf(process.platform === "win32")(
    "reports a symbolic-link root without following it",
    async () => {
      const target = await makeTempDir("articles-scan-root-target-");
      const linkRoot = path.join(root, "root-link");

      await fs.symlink(target, linkRoot, "dir");

      const result = await scan(linkRoot);

      expect(result.issues[0]).toMatchObject({
        code: "ROOT_SYMLINK",
        path: linkRoot,
        severity: "error",
      });
    }
  );

  it("aborts without touching the cache when the root exceeds its entry budget", async () => {
    await createCustomerFolder("customer-0001");
    await createCustomerFolder("customer-0002");
    const firstPath = path.join(root, "customer-0001", "article-1");

    insertRow(firstPath);

    const result = await scan(root, 1);

    expect(result).toMatchObject({
      created: 0,
      removed: 0,
      scanned: 0,
      unchanged: 0,
      updated: 0,
    });
    expect(result.issues[0]).toMatchObject({
      code: "ROOT_UNREADABLE",
      severity: "error",
    });
    expect(getArticleRow(db, firstPath)).not.toBeNull();
  });
});

describe("valid articles", () => {
  it("caches a valid article with its canonical parameters and revision count", async () => {
    const customerPath = await createCustomerFolder("customer-0001");
    const articlePath = await writeArticle(
      customerPath,
      "article-example-1",
      { CODE: "article-example-1", customer: 1, schemaVersion: 1 },
      ["REV_0", "REV_01", "REV_1"]
    );

    const result = await scan(root);

    expect(result).toMatchObject({
      created: 1,
      removed: 0,
      root,
      scanned: 1,
      unchanged: 0,
      updated: 0,
    });
    expect(result.issues).toEqual([]);

    const row = getArticleRow(db, articlePath);

    expect(row).toMatchObject({
      activeRevision: null,
      customerCode: "0001",
      customerFolderPath: customerPath,
      folderName: "article-example-1",
      folderPath: articlePath,
      revisionCount: 2,
      schemaVersion: 1,
      searchText: "article-example-1 article-example-1 0",
    });
    expect(row?.folderMtimeMs).toBeGreaterThan(0);
    expect(row?.metadataJson).toEqual({
      activeRevision: null,
      customer: 1,
      customParameters: {},
      parameters: { CODE: "article-example-1", EVO: "0" },
      schemaVersion: 1,
    });
  });

  it("caches custom parameters and includes them in the search text", async () => {
    const customerPath = await createCustomerFolder("customer-0001");
    const articlePath = await writeArticle(customerPath, "custom", {
      CODE: "custom",
      CUSTOM: "Value",
      customer: 1,
      FLAG: true,
      NUM: 3,
      schemaVersion: 1,
    });

    await scan(root);

    const row = getArticleRow(db, articlePath);

    expect(row?.metadataJson).toMatchObject({
      customParameters: { CUSTOM: "Value", FLAG: true, NUM: 3 },
    });
    expect(row?.searchText).toBe("custom custom 0 value true 3");
  });

  it("counts padded revisions and rejects non-canonical forms", async () => {
    const customerPath = await createCustomerFolder(
      "customer-0002",
      paddedRevisionConfig()
    );
    const articlePath = await writeArticle(
      customerPath,
      "padded",
      { CODE: "padded", customer: 2, schemaVersion: 1 },
      ["REV-00", "REV-01", "REV-100", "REV-001"]
    );

    const result = await scan(root);

    expect(result.created).toBe(1);
    expect(getArticleRow(db, articlePath)?.revisionCount).toBe(3);
  });

  it("records the active revision from the article data", async () => {
    const customerPath = await createCustomerFolder("customer-0001");
    const articlePath = await writeArticle(customerPath, "active", {
      activeRevision: "REV_1",
      CODE: "active",
      customer: 1,
      schemaVersion: 1,
    });

    await scan(root);

    expect(getArticleRow(db, articlePath)?.activeRevision).toBe("REV_1");
  });
});

describe("customer articleCount vs the stricter article scanner", () => {
  it("counts an article the customer rule accepts but the scanner rejects", async () => {
    const customerPath = await createCustomerFolder("customer-0001");
    // Minimal validity for `articleCount`: a plain object, an integer
    // schemaVersion >= 1 and a matching customer. The declared CODE parameter
    // is required by the customer config, so `parseArticleConfig` rejects it.
    const articlePath = await writeArticle(customerPath, "minimal", {
      customer: 1,
      schemaVersion: 1,
    });

    const counted = await countValidArticles(customerPath, "0001");

    expect(counted).toEqual({ articleCount: 1, issues: [] });

    // Seed a row from a previous scan: the stricter scanner must not cache the
    // article and must drop the stale row.
    insertRow(articlePath);

    const result = await scan(root);

    expect(result).toMatchObject({
      created: 0,
      removed: 1,
      scanned: 0,
      unchanged: 0,
      updated: 0,
    });
    expect(issueCodes(result)).toEqual(["ARTICLE_DATA_INVALID"]);
    expect(getArticleRow(db, articlePath)).toBeNull();
  });
});

describe("invalid entries", () => {
  it("skips invalid article data and reports the matching issue", async () => {
    const customerPath = await createCustomerFolder("customer-0001");

    await fs.mkdir(path.join(customerPath, "broken-json"));
    await fs.writeFile(
      path.join(customerPath, "broken-json", ARTICLE_FILE),
      "{not json"
    );

    await fs.mkdir(path.join(customerPath, "missing-data"));

    await writeArticle(customerPath, "wrong-customer", {
      CODE: "wrong-customer",
      customer: 2,
      schemaVersion: 1,
    });

    const result = await scan(root);

    expect(result).toMatchObject({ created: 0, removed: 0, scanned: 0 });
    expect([...issueCodes(result)].sort()).toEqual(
      [
        "ARTICLE_DATA_INVALID_JSON",
        "ARTICLE_DATA_MISSING",
        "ARTICLE_DATA_INVALID",
      ].sort()
    );
    expect(listArticleRows(db)).toEqual([]);
  });

  it("skips a customer with an invalid config and deletes its stale rows", async () => {
    const customerPath = await createCustomerFolder(
      "customer-0001",
      "{not json"
    );
    const articlePath = await writeArticle(customerPath, "article-1", {
      CODE: "article-1",
      customer: 1,
      schemaVersion: 1,
    });

    insertRow(articlePath);

    const result = await scan(root);

    expect(result).toMatchObject({ created: 0, removed: 1, scanned: 0 });
    expect(issueCodes(result)).toContain("CUSTOMER_CONFIG_INVALID_JSON");
    expect(getArticleRow(db, articlePath)).toBeNull();
  });

  it("distinguishes a missing config from an invalid shape", async () => {
    const missing = path.join(root, "customer-0001");

    await fs.mkdir(missing, { recursive: true });

    const invalid = await createCustomerFolder("customer-0002", {
      schemaVersion: 1,
    });

    await writeArticle(missing, "article-1", {
      CODE: "article-1",
      customer: 1,
      schemaVersion: 1,
    });
    await writeArticle(invalid, "article-1", {
      CODE: "article-1",
      customer: 2,
      schemaVersion: 1,
    });

    const result = await scan(root);

    expect(issueCodes(result)).toEqual([
      "CUSTOMER_CONFIG_MISSING",
      "CUSTOMER_CONFIG_INVALID",
    ]);
    expect(listArticleRows(db)).toEqual([]);
  });

  it("skips an unknown revision count instead of caching zero", async () => {
    const customerPath = await createCustomerFolder("customer-0001");
    const articlePath = await writeArticle(customerPath, "article-1", {
      CODE: "article-1",
      customer: 1,
      schemaVersion: 1,
    });

    revisionControl.mode = "generic";

    const result = await scan(root);

    expect(result).toMatchObject({ created: 0, scanned: 0 });
    expect(issueCodes(result)).toEqual(["ARTICLE_DATA_UNREADABLE"]);
    expect(getArticleRow(db, articlePath)).toBeNull();
  });

  it("preserves the cached row when the matcher budget is exhausted", async () => {
    const customerPath = await createCustomerFolder("customer-0001");
    const articlePath = await writeArticle(customerPath, "article-1", {
      CODE: "article-1",
      customer: 1,
      schemaVersion: 1,
    });

    await scan(root);

    const before = getArticleRow(db, articlePath);

    expect(before).not.toBeNull();

    revisionControl.mode = "budget";

    const result = await scan(root);

    expect(result).toMatchObject({ created: 0, removed: 0, scanned: 0 });
    expect(issueCodes(result)).toEqual(["ARTICLE_DATA_UNREADABLE"]);
    expect(getArticleRow(db, articlePath)?.updatedAt).toBe(before?.updatedAt);
  });

  it("ignores hidden and unrelated entries but flags customer-named files", async () => {
    await createCustomerFolder("customer-0001");
    await fs.mkdir(path.join(root, ".hidden"));
    await fs.mkdir(path.join(root, "documents"));
    await fs.mkdir(path.join(root, "customer-12"));

    const filePath = path.join(root, "customer-0003");

    await fs.writeFile(filePath, "regular file");

    const result = await scan(root);

    expect(result).toMatchObject({ created: 0, scanned: 0 });
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]).toMatchObject({
      code: "CUSTOMER_FOLDER_NOT_DIRECTORY",
      path: filePath,
      severity: "error",
    });
    expect(result.issues[1]).toMatchObject({
      code: "ENTRY_UNEXPECTED",
      path: path.join(root, "customer-12"),
      severity: "warning",
    });
  });

  it.skipIf(process.platform === "win32")(
    "reports a symlinked customer folder without following it",
    async () => {
      const target = await makeTempDir("articles-scan-customer-target-");
      const linkPath = path.join(root, "customer-0001");

      await fs.writeFile(
        path.join(target, CONFIG_FILE),
        JSON.stringify(validConfig())
      );
      await fs.mkdir(path.join(target, "article-1"), { recursive: true });
      await fs.writeFile(
        path.join(target, "article-1", ARTICLE_FILE),
        JSON.stringify({ CODE: "article-1", customer: 1, schemaVersion: 1 })
      );
      await fs.symlink(target, linkPath, "dir");

      const result = await scan(root);

      expect(result).toMatchObject({ created: 0, scanned: 0 });
      expect(result.issues[0]).toMatchObject({
        code: "CUSTOMER_FOLDER_SYMLINK",
        path: linkPath,
        severity: "error",
      });
      expect(listArticleRows(db)).toEqual([]);
    }
  );

  it.skipIf(process.platform === "win32")(
    "reports a symlinked article folder without following it",
    async () => {
      const customerPath = await createCustomerFolder("customer-0001");
      const target = await makeTempDir("articles-scan-article-target-");

      await fs.writeFile(
        path.join(target, ARTICLE_FILE),
        JSON.stringify({ CODE: "linked", customer: 1, schemaVersion: 1 })
      );
      await fs.symlink(target, path.join(customerPath, "linked"), "dir");

      const result = await scan(root);

      expect(result).toMatchObject({ created: 0, scanned: 0 });
      expect(issueCodes(result)).toEqual(["ARTICLE_FOLDER_SYMLINK"]);
      expect(listArticleRows(db)).toEqual([]);
    }
  );

  it("reports a non-directory article entry", async () => {
    const customerPath = await createCustomerFolder("customer-0001");

    await fs.writeFile(path.join(customerPath, "loose-file"), "hello");

    const result = await scan(root);

    expect(result).toMatchObject({ created: 0, scanned: 0 });
    expect(issueCodes(result)).toEqual(["ARTICLE_FOLDER_NOT_DIRECTORY"]);
  });
});

describe("transient customer failures", () => {
  it("preserves cached rows when the customer folder is not a directory", async () => {
    const customerPath = path.join(root, "customer-0001");

    await fs.writeFile(customerPath, "not a directory");

    const articlePath = path.join(customerPath, "article-1");

    insertRow(articlePath);

    const result = await scan(root);

    expect(result).toMatchObject({ created: 0, removed: 0, scanned: 0 });
    expect(issueCodes(result)).toEqual(["CUSTOMER_FOLDER_NOT_DIRECTORY"]);
    expect(getArticleRow(db, articlePath)).not.toBeNull();
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "preserves cached rows when the customer folder cannot be listed",
    async () => {
      const customerPath = await createCustomerFolder("customer-0001");
      const articlePath = await writeArticle(customerPath, "article-1", {
        CODE: "article-1",
        customer: 1,
        schemaVersion: 1,
      });

      insertRow(articlePath);

      // Execute-only: the known customer_data.json stays readable, but the
      // directory cannot be enumerated.
      await fs.chmod(customerPath, 0o111);

      try {
        const result = await scan(root);

        expect(result).toMatchObject({ created: 0, removed: 0, scanned: 0 });
        expect(issueCodes(result)).toEqual(["ARTICLE_DATA_UNREADABLE"]);
        expect(getArticleRow(db, articlePath)).not.toBeNull();
      } finally {
        await fs.chmod(customerPath, 0o755);
      }
    }
  );

  it("preserves cached rows when a customer exceeds the entry budget", async () => {
    const customerPath = await createCustomerFolder("customer-0001");

    await writeArticle(customerPath, "article-1", {
      CODE: "article-1",
      customer: 1,
      schemaVersion: 1,
    });
    await writeArticle(customerPath, "article-2", {
      CODE: "article-2",
      customer: 1,
      schemaVersion: 1,
    });

    const cachedPath = path.join(customerPath, "article-1");

    insertRow(cachedPath);

    const result = await scan(root, undefined, 1);

    expect(result.removed).toBe(0);
    expect(issueCodes(result)).toEqual(["ARTICLE_DATA_UNREADABLE"]);
    expect(getArticleRow(db, cachedPath)).not.toBeNull();
  });
});

describe("reconciliation", () => {
  it("creates, keeps, updates and removes rows across scans", async () => {
    const customerPath = await createCustomerFolder("customer-0001");
    const articlePath = await writeArticle(customerPath, "article-1", {
      CODE: "article-1",
      customer: 1,
      schemaVersion: 1,
    });

    const first = await scan(root);

    expect(first).toMatchObject({
      created: 1,
      removed: 0,
      scanned: 1,
      unchanged: 0,
      updated: 0,
    });

    const firstRow = getArticleRow(db, articlePath);

    const second = await scan(root);

    expect(second).toMatchObject({
      created: 0,
      removed: 0,
      scanned: 1,
      unchanged: 1,
      updated: 0,
    });
    expect(getArticleRow(db, articlePath)?.updatedAt).toBe(firstRow?.updatedAt);

    await fs.writeFile(
      path.join(articlePath, ARTICLE_FILE),
      JSON.stringify({
        CODE: "article-1",
        CUSTOM: "changed",
        customer: 1,
        schemaVersion: 1,
      })
    );

    const third = await scan(root);

    expect(third).toMatchObject({
      created: 0,
      removed: 0,
      scanned: 1,
      unchanged: 0,
      updated: 1,
    });
    expect(getArticleRow(db, articlePath)?.metadataJson).toMatchObject({
      customParameters: { CUSTOM: "changed" },
    });

    await fs.rm(articlePath, { force: true, recursive: true });

    const fourth = await scan(root);

    expect(fourth).toMatchObject({
      created: 0,
      removed: 1,
      scanned: 0,
      unchanged: 0,
      updated: 0,
    });
    expect(getArticleRow(db, articlePath)).toBeNull();
  });

  it("removes rows from a previous root", async () => {
    await createCustomerFolder("customer-0001");

    await scan(root);

    const outsideDir = await makeTempDir("articles-scan-outside-");
    const outsideArticle = path.join(outsideDir, "customer-0002", "article-1");

    insertRow(outsideArticle);

    const result = await scan(root);

    expect(result.removed).toBe(1);
    expect(getArticleRow(db, outsideArticle)).toBeNull();
  });

  it("caps issues at 200 and notes the truncation", async () => {
    const customerPath = await createCustomerFolder("customer-0001");
    const names = Array.from(
      { length: 205 },
      (_, index) => `article-${String(index).padStart(3, "0")}`
    );

    await Promise.all(
      names.map((name) => fs.mkdir(path.join(customerPath, name)))
    );

    const result = await scan(root);

    expect(result.issues).toHaveLength(200);

    // Streaming means the retained subset depends on directory order, but every
    // retained issue must belong to a real folder and the truncation note is
    // always the final entry.
    const retained = result.issues.slice(0, 199);
    const retainedNames = retained.map((issue) =>
      path.basename(path.dirname(issue.path ?? ""))
    );

    expect(
      retained.every((issue) => issue.code === "ARTICLE_DATA_MISSING")
    ).toBe(true);
    expect(new Set(retainedNames).size).toBe(199);

    for (const name of retainedNames) {
      expect(names).toContain(name);
    }

    expect(result.issues[199]).toMatchObject({
      code: "ENTRY_UNEXPECTED",
      severity: "warning",
    });
    expect(result.issues[199]?.message).toMatch(TRUNCATION_MESSAGE_PATTERN);
  });
});
