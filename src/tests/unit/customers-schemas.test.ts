import path from "node:path";
import { describe, expect, it } from "vitest";
import { CUSTOMER_CONFIG_SCHEMA_VERSION } from "@/customers/config";
import {
  clearCustomersOutputSchema,
  createCustomerInputSchema,
  customerCacheMetadataSchema,
  customerIssueSchema,
  customerSchema,
  customerSummarySchema,
  getCustomerOutputSchema,
  listCustomersInputSchema,
  listCustomersOutputSchema,
  removeCustomerOutputSchema,
  scanCustomersInputSchema,
  scanCustomersOutputSchema,
  updateCustomerInputSchema,
} from "@/ipc/customers/schemas";

const articleSection = {
  key: "{CODE}",
  parameters: {
    CODE: { required: true, type: "text" },
  },
  schemaVersion: CUSTOMER_CONFIG_SCHEMA_VERSION,
} as const;

const revisionSection = {
  key: "REV_{REV}",
  parameters: {
    REV: { default: "0", required: true, type: "number" },
  },
  schemaVersion: CUSTOMER_CONFIG_SCHEMA_VERSION,
} as const;

function validCreateInput(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    article: articleSection,
    name: "Acme",
    revision: revisionSection,
    ...overrides,
  };
}

function parseCreate(
  overrides: Record<string, unknown> = {}
): ReturnType<typeof createCustomerInputSchema.parse> {
  return createCustomerInputSchema.parse(validCreateInput(overrides));
}

function validIssue(): Record<string, unknown> {
  return {
    code: "CONFIG_MISSING",
    message: "customer_data.json is missing.",
    severity: "error",
  };
}

function validCacheMetadata(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    article: articleSection,
    articleCount: 1,
    issues: [],
    revision: null,
    ...overrides,
  };
}

const sampleCustomer = {
  articleCount: 1,
  articleSchemaVersion: 1,
  createdAt: 1_700_000_000_000,
  customerCode: "0001",
  folderMtimeMs: 1_700_000_000_000,
  folderName: "Acme",
  folderPath: "/customers/acme",
  metadataJson: {
    article: articleSection,
    articleCount: 1,
    issues: [],
    revision: revisionSection,
  },
  name: "Acme",
  revisionSchemaVersion: 1,
  schemaVersion: 1,
  status: "ok",
  updatedAt: 1_700_000_000_000,
} as const;

describe("listCustomersInputSchema", () => {
  it("applies pagination defaults", () => {
    expect(listCustomersInputSchema.parse({})).toEqual({
      limit: 100,
      offset: 0,
    });
  });

  it("drops a whitespace-only search", () => {
    expect(
      listCustomersInputSchema.parse({ search: "   " }).search
    ).toBeUndefined();
  });

  it("keeps a trimmed search", () => {
    expect(listCustomersInputSchema.parse({ search: " acme " }).search).toBe(
      "acme"
    );
  });

  it("accepts pagination boundaries", () => {
    expect(listCustomersInputSchema.parse({ limit: 1 }).limit).toBe(1);
    expect(listCustomersInputSchema.parse({ limit: 500 }).limit).toBe(500);
    expect(listCustomersInputSchema.parse({ offset: 0 }).offset).toBe(0);
  });

  it("rejects pagination outside its bounds", () => {
    expect(() => listCustomersInputSchema.parse({ limit: 0 })).toThrow();
    expect(() => listCustomersInputSchema.parse({ limit: 501 })).toThrow();
    expect(() => listCustomersInputSchema.parse({ offset: -1 })).toThrow();
  });

  it("caps the search length", () => {
    expect(
      listCustomersInputSchema.parse({ search: "x".repeat(256) }).search
    ).toBe("x".repeat(256));
    expect(() =>
      listCustomersInputSchema.parse({ search: "x".repeat(257) })
    ).toThrow();
  });

  it("rejects unknown keys", () => {
    expect(() => listCustomersInputSchema.parse({ searchh: "acme" })).toThrow();
  });
});

describe("createCustomerInputSchema", () => {
  it("accepts a clean definition with no customer code", () => {
    const result = parseCreate();

    expect(result.customerCode).toBeUndefined();
    expect(result.name).toBe("Acme");
    expect(result.article.key).toBe("{CODE}");
  });

  it.each(["0001", "1234", "9999"])("accepts customer code %s", (code) => {
    expect(parseCreate({ customerCode: code }).customerCode).toBe(code);
  });

  it.each([
    ["the reserved 0000 code", "0000"],
    ["five digits", "12345"],
    ["letters", "ABCD"],
    ["a single digit", "1"],
    ["a non-string", 1],
  ])("rejects %s", (_label, customerCode) => {
    expect(() => parseCreate({ customerCode })).toThrow();
  });

  it("trims the customer name", () => {
    expect(parseCreate({ name: "  Acme  " }).name).toBe("Acme");
  });

  it.each([
    ["a missing name", undefined],
    ["an empty name", ""],
    ["a whitespace-only name", "   "],
    ["a name longer than 256 characters", "x".repeat(257)],
  ])("rejects %s", (_label, name) => {
    expect(() => parseCreate({ name })).toThrow();
  });

  it("accepts a name of exactly 256 characters", () => {
    expect(parseCreate({ name: "x".repeat(256) }).name).toBe("x".repeat(256));
  });

  it("rejects unknown keys", () => {
    expect(() => parseCreate({ misspelledName: "Acme" })).toThrow();
  });

  it.each([
    ["an undeclared placeholder", { ...articleSection, key: "{MISSING}" }],
    ["a template without placeholders", { ...articleSection, key: "ART" }],
    [
      "zero padding on a text parameter",
      { ...articleSection, key: "{CODE:00}" },
    ],
    [
      "an unsupported parameter type",
      {
        ...articleSection,
        parameters: { CODE: { required: true, type: "integer" } },
      },
    ],
    [
      "an invalid numeric default",
      {
        ...articleSection,
        parameters: {
          CODE: { default: "abc", required: true, type: "number" },
        },
      },
    ],
    ["an unsupported schema version", { ...articleSection, schemaVersion: 2 }],
  ])("rejects an invalid article section: %s", (_label, article) => {
    expect(() => parseCreate({ article })).toThrow();
  });

  it("rejects an invalid revision section", () => {
    expect(() =>
      parseCreate({
        revision: {
          ...revisionSection,
          key: "{REV:00}",
          parameters: { REV: { required: true, type: "text" } },
        },
      })
    ).toThrow();
  });
});

describe("updateCustomerInputSchema", () => {
  it("accepts an update with only a name", () => {
    const result = updateCustomerInputSchema.parse({
      folderPath: "/customers/acme",
      name: "Acme",
    });

    expect(result.name).toBe("Acme");
  });

  it("accepts an update with only an article", () => {
    const result = updateCustomerInputSchema.parse({
      article: articleSection,
      folderPath: "/customers/acme",
    });

    expect(result.article).toEqual(articleSection);
  });

  it("accepts an update with only a revision", () => {
    const result = updateCustomerInputSchema.parse({
      folderPath: "/customers/acme",
      revision: revisionSection,
    });

    expect(result.revision).toEqual(revisionSection);
  });

  it("canonicalises the folder path", () => {
    const result = updateCustomerInputSchema.parse({
      folderPath: "./customers/../customers/c-001/",
      name: "Acme",
    });

    expect(result.folderPath).toBe(path.resolve("./customers/c-001"));
  });

  it("rejects an update that changes nothing", () => {
    expect(() =>
      updateCustomerInputSchema.parse({ folderPath: "/customers/acme" })
    ).toThrow();
  });

  it("rejects unknown keys", () => {
    expect(() =>
      updateCustomerInputSchema.parse({
        folderPath: "/customers/acme",
        name: "Acme",
        unknown: true,
      })
    ).toThrow();
  });

  it("rejects a folder path containing NUL", () => {
    expect(() =>
      updateCustomerInputSchema.parse({
        folderPath: "/customers/\u0000bad",
        name: "Acme",
      })
    ).toThrow();
  });

  it("rejects an over-long folder path", () => {
    expect(() =>
      updateCustomerInputSchema.parse({
        folderPath: `/${"a".repeat(4096)}`,
        name: "Acme",
      })
    ).toThrow();
  });

  it.each(["", "   "])("rejects an empty name (%j)", (name) => {
    expect(() =>
      updateCustomerInputSchema.parse({
        folderPath: "/customers/acme",
        name,
      })
    ).toThrow();
  });

  it("rejects an invalid article section", () => {
    expect(() =>
      updateCustomerInputSchema.parse({
        article: { ...articleSection, key: "{MISSING}" },
        folderPath: "/customers/acme",
      })
    ).toThrow();
  });
});

describe("scanCustomersInputSchema", () => {
  it("accepts an empty input", () => {
    expect(scanCustomersInputSchema.parse({})).toEqual({});
  });

  it("rejects unknown keys", () => {
    expect(() => scanCustomersInputSchema.parse({ root: "/x" })).toThrow();
  });
});

describe("customerIssueSchema", () => {
  it.each(["warning", "error"])("accepts severity %s", (severity) => {
    expect(
      customerIssueSchema.parse({ ...validIssue(), severity }).severity
    ).toBe(severity);
  });

  it("accepts an optional path", () => {
    expect(
      customerIssueSchema.parse({ ...validIssue(), path: "/customers/acme" })
        .path
    ).toBe("/customers/acme");
  });

  it("caps the message length", () => {
    expect(
      customerIssueSchema.parse({ ...validIssue(), message: "x".repeat(1024) })
        .message
    ).toHaveLength(1024);

    expect(() =>
      customerIssueSchema.parse({ ...validIssue(), message: "" })
    ).toThrow();
    expect(() =>
      customerIssueSchema.parse({ ...validIssue(), message: "x".repeat(1025) })
    ).toThrow();
  });

  it("caps the path length", () => {
    expect(() =>
      customerIssueSchema.parse({ ...validIssue(), path: "x".repeat(4096) })
    ).not.toThrow();
    expect(() =>
      customerIssueSchema.parse({ ...validIssue(), path: "x".repeat(4097) })
    ).toThrow();
  });

  it.each([
    ["an unknown code", { code: "SOMETHING_ELSE" }],
    ["an unknown severity", { severity: "info" }],
    ["an unknown key", { extra: true }],
  ])("rejects %s", (_label, override) => {
    expect(() =>
      customerIssueSchema.parse({ ...validIssue(), ...override })
    ).toThrow();
  });
});

describe("customerCacheMetadataSchema", () => {
  it("accepts metadata with null sections", () => {
    expect(
      customerCacheMetadataSchema.parse({
        article: null,
        articleCount: 0,
        issues: [],
        revision: null,
      })
    ).toEqual({
      article: null,
      articleCount: 0,
      issues: [],
      revision: null,
    });
  });

  it("accepts populated sections and issues", () => {
    const result = customerCacheMetadataSchema.parse(
      validCacheMetadata({ issues: [validIssue()] })
    );

    expect(result.article).toEqual(articleSection);
    expect(result.issues).toHaveLength(1);
  });

  it.each([
    ["a negative count", -1],
    ["a fractional count", 1.5],
    ["a non-numeric count", "1"],
  ])("rejects %s", (_label, articleCount) => {
    expect(() =>
      customerCacheMetadataSchema.parse(validCacheMetadata({ articleCount }))
    ).toThrow();
  });

  it("accepts up to 200 issues and rejects more", () => {
    const issues = Array.from({ length: 200 }, () => validIssue());

    expect(
      customerCacheMetadataSchema.parse(validCacheMetadata({ issues })).issues
    ).toHaveLength(200);

    expect(() =>
      customerCacheMetadataSchema.parse(
        validCacheMetadata({ issues: [...issues, validIssue()] })
      )
    ).toThrow();
  });

  it("rejects unknown keys", () => {
    expect(() =>
      customerCacheMetadataSchema.parse(validCacheMetadata({ extra: true }))
    ).toThrow();
  });

  it.each([
    ["an undeclared placeholder", { ...articleSection, key: "{MISSING}" }],
    ["an unsupported schema version", { ...articleSection, schemaVersion: 2 }],
    ["an invalid issue", { code: "NOPE", message: "x", severity: "error" }],
  ])("rejects invalid metadata: %s", (_label, article) => {
    expect(() =>
      customerCacheMetadataSchema.parse(validCacheMetadata({ article }))
    ).toThrow();
  });
});

describe("output schemas", () => {
  it("requires articleCount on a summary", () => {
    const { articleCount: _articleCount, ...withoutCount } = sampleCustomer;

    expect(customerSummarySchema.parse(sampleCustomer).articleCount).toBe(1);
    expect(() => customerSummarySchema.parse(withoutCount)).toThrow();
  });

  it("round-trips a customer through customerSchema", () => {
    expect(customerSchema.parse(sampleCustomer)).toEqual(sampleCustomer);
  });

  it("round-trips getCustomer", () => {
    expect(getCustomerOutputSchema.parse(sampleCustomer)).toEqual(
      sampleCustomer
    );
    expect(getCustomerOutputSchema.parse(null)).toBeNull();
  });

  it("round-trips a list page", () => {
    const result = listCustomersOutputSchema.parse({
      items: [sampleCustomer],
      total: 1,
    });

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it("round-trips a scan result", () => {
    const result = scanCustomersOutputSchema.parse({
      created: 1,
      issues: [validIssue()],
      removed: 0,
      root: "/customers",
      scanned: 2,
      unchanged: 1,
      updated: 0,
    });

    expect(result.scanned).toBe(2);
    expect(result.root).toBe("/customers");
  });

  it("rejects an unknown key in a scan result", () => {
    expect(() =>
      scanCustomersOutputSchema.parse({
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

  it("keeps the scalar output schemas", () => {
    expect(removeCustomerOutputSchema.parse("/customers/acme")).toBe(
      "/customers/acme"
    );
    expect(clearCustomersOutputSchema.parse(3)).toBe(3);
    expect(() => clearCustomersOutputSchema.parse(-1)).toThrow();
  });
});
