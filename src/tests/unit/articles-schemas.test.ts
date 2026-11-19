import path from "node:path";
import { describe, expect, it } from "vitest";
import { ARTICLE_ISSUE_CODES } from "@/articles/types";
import {
  articleCacheMetadataSchema,
  articleIssueSchema,
  articleSchema,
  articleSummarySchema,
  clearArticlesOutputSchema,
  createArticleInputSchema,
  createArticleOutputSchema,
  getArticleOutputSchema,
  listArticlesInputSchema,
  listArticlesOutputSchema,
  parameterNameSchema,
  removeArticleInputSchema,
  removeArticleOutputSchema,
  scanArticlesInputSchema,
  scanArticlesOutputSchema,
  updateArticleInputSchema,
} from "@/ipc/articles/schemas";

const CUSTOMER_FOLDER_PATH = "/articles/customer-0001";

function parameterEntries(count: number): Record<string, string> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`P${index}`, "value"])
  );
}

const sampleSummary = {
  activeRevision: "REV_1",
  createdAt: 1_700_000_000_000,
  customerCode: "0001",
  customerFolderPath: "/articles/customer-0001",
  folderMtimeMs: 1_700_000_000_000,
  folderName: "article-1",
  folderPath: "/articles/customer-0001/article-1",
  revisionCount: 2,
  schemaVersion: 1,
  updatedAt: 1_700_000_000_000,
} as const;

const sampleMetadata = {
  activeRevision: "REV_1",
  customer: 1,
  customParameters: { FLAG: true, NOTE: "n", WEIGHT: 1.5 },
  parameters: { CODE: "article-1", EVO: "0" },
  schemaVersion: 1,
} as const;

const sampleArticle = {
  ...sampleSummary,
  metadataJson: sampleMetadata,
} as const;

function validIssue(): Record<string, unknown> {
  return {
    code: "ARTICLE_DATA_INVALID",
    message: "article_data.json is invalid.",
    severity: "warning",
  };
}

describe("parameterNameSchema", () => {
  it.each(["A", "CODE", "EVO_01", "A".repeat(64)])("accepts %s", (name) => {
    expect(parameterNameSchema.parse(name)).toBe(name);
  });

  it.each([
    ["lowercase", "code"],
    ["a leading digit", "1CODE"],
    ["a leading underscore", "_CODE"],
    ["a 65-character name", "A".repeat(65)],
    ["an empty name", ""],
    ["a dash", "CODE-1"],
  ])("rejects %s", (_label, name) => {
    expect(() => parameterNameSchema.parse(name)).toThrow();
  });
});

describe("article path schema", () => {
  it("canonicalises a relative customer folder path", () => {
    const result = createArticleInputSchema.parse({
      customerFolderPath: "./articles/customer-0001/",
      parameters: {},
    });

    expect(result.customerFolderPath).toBe(
      path.resolve("./articles/customer-0001")
    );
  });

  it("rejects NUL, empty and over-long paths", () => {
    for (const customerFolderPath of [
      "/articles/\u0000bad",
      "",
      `/${"a".repeat(4096)}`,
    ]) {
      expect(() =>
        createArticleInputSchema.parse({
          customerFolderPath,
          parameters: {},
        })
      ).toThrow();
    }
  });
});

describe("listArticlesInputSchema", () => {
  it("applies pagination defaults", () => {
    expect(
      listArticlesInputSchema.parse({
        customerFolderPath: CUSTOMER_FOLDER_PATH,
      })
    ).toEqual({
      customerFolderPath: path.resolve(CUSTOMER_FOLDER_PATH),
      limit: 100,
      offset: 0,
    });
  });

  it("drops a whitespace-only search and trims a real one", () => {
    expect(
      listArticlesInputSchema.parse({
        customerFolderPath: CUSTOMER_FOLDER_PATH,
        search: "   ",
      }).search
    ).toBeUndefined();
    expect(
      listArticlesInputSchema.parse({
        customerFolderPath: CUSTOMER_FOLDER_PATH,
        search: " article ",
      }).search
    ).toBe("article");
  });

  it("accepts the pagination boundaries", () => {
    expect(
      listArticlesInputSchema.parse({
        customerFolderPath: CUSTOMER_FOLDER_PATH,
        limit: 1,
      }).limit
    ).toBe(1);
    expect(
      listArticlesInputSchema.parse({
        customerFolderPath: CUSTOMER_FOLDER_PATH,
        limit: 500,
      }).limit
    ).toBe(500);
    expect(
      listArticlesInputSchema.parse({
        customerFolderPath: CUSTOMER_FOLDER_PATH,
        offset: 0,
      }).offset
    ).toBe(0);
  });

  it("rejects pagination outside its bounds", () => {
    expect(() =>
      listArticlesInputSchema.parse({
        customerFolderPath: CUSTOMER_FOLDER_PATH,
        limit: 0,
      })
    ).toThrow();
    expect(() =>
      listArticlesInputSchema.parse({
        customerFolderPath: CUSTOMER_FOLDER_PATH,
        limit: 501,
      })
    ).toThrow();
    expect(() =>
      listArticlesInputSchema.parse({
        customerFolderPath: CUSTOMER_FOLDER_PATH,
        offset: -1,
      })
    ).toThrow();
  });

  it("caps the search length", () => {
    expect(() =>
      listArticlesInputSchema.parse({
        customerFolderPath: CUSTOMER_FOLDER_PATH,
        search: "x".repeat(257),
      })
    ).toThrow();
  });

  it("requires the customer folder path and rejects unknown keys", () => {
    expect(() => listArticlesInputSchema.parse({})).toThrow();
    expect(() =>
      listArticlesInputSchema.parse({
        customerFolderPath: CUSTOMER_FOLDER_PATH,
        searchh: "article",
      })
    ).toThrow();
  });
});

describe("createArticleInputSchema", () => {
  it("accepts declared and custom scalar values", () => {
    const result = createArticleInputSchema.parse({
      customerFolderPath: CUSTOMER_FOLDER_PATH,
      customParameters: { FLAG: true, NOTE: "n", WEIGHT: 1.5 },
      parameters: { CODE: "article-1", EVO: 0 },
    });

    expect(result.parameters).toEqual({ CODE: "article-1", EVO: 0 });
    expect(result.customParameters).toEqual({
      FLAG: true,
      NOTE: "n",
      WEIGHT: 1.5,
    });
  });

  it("requires the parameters map", () => {
    expect(() =>
      createArticleInputSchema.parse({
        customerFolderPath: CUSTOMER_FOLDER_PATH,
      })
    ).toThrow();
  });

  it.each([
    ["a lowercase parameter name", { code: "article-1" }],
    ["an empty parameter name", { "": "value" }],
    ["a null value", { CODE: null }],
    ["an object value", { CODE: { nested: true } }],
    ["an array value", { CODE: ["a"] }],
    ["an over-long string value", { CODE: "x".repeat(1025) }],
    ["an infinite number", { CODE: Number.POSITIVE_INFINITY }],
    ["NaN", { CODE: Number.NaN }],
  ])("rejects %s", (_label, parameters) => {
    expect(() =>
      createArticleInputSchema.parse({
        customerFolderPath: CUSTOMER_FOLDER_PATH,
        parameters,
      })
    ).toThrow();
  });

  it("accepts at most 64 parameters and rejects 65", () => {
    expect(
      Object.keys(
        createArticleInputSchema.parse({
          customerFolderPath: CUSTOMER_FOLDER_PATH,
          parameters: parameterEntries(64),
        }).parameters
      )
    ).toHaveLength(64);

    expect(() =>
      createArticleInputSchema.parse({
        customerFolderPath: CUSTOMER_FOLDER_PATH,
        parameters: parameterEntries(65),
      })
    ).toThrow();
  });

  it("rejects unknown keys", () => {
    expect(() =>
      createArticleInputSchema.parse({
        customerFolderPath: CUSTOMER_FOLDER_PATH,
        parameters: {},
        unknown: true,
      })
    ).toThrow();
  });
});

describe("updateArticleInputSchema", () => {
  it("accepts only parameters", () => {
    const result = updateArticleInputSchema.parse({
      folderPath: "/articles/customer-0001/article-1",
      parameters: { CODE: "article-1" },
    });

    expect(result.folderPath).toBe(
      path.resolve("/articles/customer-0001/article-1")
    );
    expect(result.customParameters).toBeUndefined();
  });

  it("accepts only custom parameters", () => {
    const result = updateArticleInputSchema.parse({
      customParameters: { NOTE: "n" },
      folderPath: "/articles/customer-0001/article-1",
    });

    expect(result.parameters).toBeUndefined();
    expect(result.customParameters).toEqual({ NOTE: "n" });
  });

  it("rejects an update that changes nothing", () => {
    expect(() =>
      updateArticleInputSchema.parse({
        folderPath: "/articles/customer-0001/article-1",
      })
    ).toThrow();
  });

  it("rejects unknown keys and invalid values", () => {
    expect(() =>
      updateArticleInputSchema.parse({
        folderPath: "/articles/customer-0001/article-1",
        parameters: {},
        unknown: true,
      })
    ).toThrow();
    expect(() =>
      updateArticleInputSchema.parse({
        folderPath: "/articles/customer-0001/article-1",
        parameters: { CODE: null },
      })
    ).toThrow();
  });
});

describe("removeArticleInputSchema and scanArticlesInputSchema", () => {
  it("resolves the article folder path", () => {
    expect(
      removeArticleInputSchema.parse({
        folderPath: "/articles/customer-0001/../customer-0001/article-1",
      }).folderPath
    ).toBe(path.resolve("/articles/customer-0001/article-1"));
  });

  it("rejects unknown keys", () => {
    expect(() =>
      removeArticleInputSchema.parse({ extra: true, folderPath: "/x" })
    ).toThrow();
  });

  it("accepts an empty scan input and rejects unknown keys", () => {
    expect(scanArticlesInputSchema.parse({})).toEqual({});
    expect(() => scanArticlesInputSchema.parse({ root: "/x" })).toThrow();
  });
});

describe("articleIssueSchema", () => {
  it.each(ARTICLE_ISSUE_CODES)("accepts issue code %s", (code) => {
    expect(articleIssueSchema.parse({ ...validIssue(), code }).code).toBe(code);
  });

  it.each(["warning", "error"])("accepts severity %s", (severity) => {
    expect(
      articleIssueSchema.parse({ ...validIssue(), severity }).severity
    ).toBe(severity);
  });

  it("accepts an optional path", () => {
    expect(
      articleIssueSchema.parse({
        ...validIssue(),
        path: "/articles/customer-0001",
      }).path
    ).toBe("/articles/customer-0001");
  });

  it("caps the message and path lengths", () => {
    expect(
      articleIssueSchema.parse({ ...validIssue(), message: "x".repeat(1024) })
        .message
    ).toHaveLength(1024);
    expect(() =>
      articleIssueSchema.parse({ ...validIssue(), message: "" })
    ).toThrow();
    expect(() =>
      articleIssueSchema.parse({ ...validIssue(), message: "x".repeat(1025) })
    ).toThrow();
    expect(() =>
      articleIssueSchema.parse({ ...validIssue(), path: "x".repeat(4097) })
    ).toThrow();
  });

  it.each([
    ["an unknown code", { code: "SOMETHING_ELSE" }],
    ["an unknown severity", { severity: "info" }],
    ["an unknown key", { extra: true }],
  ])("rejects %s", (_label, override) => {
    expect(() =>
      articleIssueSchema.parse({ ...validIssue(), ...override })
    ).toThrow();
  });
});

describe("articleCacheMetadataSchema", () => {
  it("accepts the stored metadata shape", () => {
    expect(articleCacheMetadataSchema.parse(sampleMetadata)).toEqual(
      sampleMetadata
    );
  });

  it("accepts a null active revision", () => {
    expect(
      articleCacheMetadataSchema.parse({
        ...sampleMetadata,
        activeRevision: null,
      }).activeRevision
    ).toBeNull();
  });

  it.each([
    ["a schema version below one", { schemaVersion: 0 }],
    ["a fractional schema version", { schemaVersion: 1.5 }],
    ["a fractional customer", { customer: 1.5 }],
    ["a string customer", { customer: "0001" }],
    ["an empty active revision", { activeRevision: "" }],
    ["an over-long active revision", { activeRevision: "x".repeat(256) }],
    ["a non-string declared value", { parameters: { CODE: 1 } }],
    ["an invalid custom value", { customParameters: { FLAG: null } }],
    ["an invalid parameter name", { parameters: { code: "x" } }],
  ])("rejects %s", (_label, override) => {
    expect(() =>
      articleCacheMetadataSchema.parse({ ...sampleMetadata, ...override })
    ).toThrow();
  });

  it("rejects unknown keys", () => {
    expect(() =>
      articleCacheMetadataSchema.parse({ ...sampleMetadata, extra: true })
    ).toThrow();
  });
});

describe("output schemas", () => {
  it("round-trips a summary and rejects bad timestamps", () => {
    expect(articleSummarySchema.parse(sampleSummary)).toEqual(sampleSummary);
    expect(() =>
      articleSummarySchema.parse({ ...sampleSummary, createdAt: -1 })
    ).toThrow();
    expect(() =>
      articleSummarySchema.parse({ ...sampleSummary, revisionCount: 1.5 })
    ).toThrow();
  });

  it("round-trips an article with metadata", () => {
    expect(articleSchema.parse(sampleArticle)).toEqual(sampleArticle);
    expect(
      articleSchema.parse({ ...sampleSummary, metadataJson: null }).metadataJson
    ).toBeNull();
  });

  it("round-trips list, get and mutation outputs", () => {
    expect(
      listArticlesOutputSchema.parse({
        items: [sampleSummary],
        total: 1,
      })
    ).toEqual({ items: [sampleSummary], total: 1 });
    expect(getArticleOutputSchema.parse(null)).toBeNull();
    expect(createArticleOutputSchema.parse(sampleArticle)).toEqual(
      sampleArticle
    );
    expect(removeArticleOutputSchema.parse("/a/b")).toBe("/a/b");
    expect(clearArticlesOutputSchema.parse(0)).toBe(0);
    expect(() => clearArticlesOutputSchema.parse(-1)).toThrow();
  });

  it("round-trips a scan result and rejects unknown keys", () => {
    const result = scanArticlesOutputSchema.parse({
      created: 1,
      issues: [validIssue()],
      removed: 0,
      root: "/articles",
      scanned: 2,
      unchanged: 1,
      updated: 0,
    });

    expect(result.scanned).toBe(2);
    expect(() =>
      scanArticlesOutputSchema.parse({
        created: 0,
        extra: true,
        issues: [],
        removed: 0,
        root: null,
        scanned: 0,
        unchanged: 0,
        updated: 0,
      })
    ).toThrow();
  });
});
