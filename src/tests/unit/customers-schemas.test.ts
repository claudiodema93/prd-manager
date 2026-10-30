import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  listCustomersInputSchema,
  upsertCustomerInputSchema,
} from "@/ipc/customers/schemas";

const validCustomer = {
  customerCode: "C-001",
  folderMtimeMs: 1_793_260_675_839,
  folderName: "Customer folder",
  folderPath: "/customers/c-001",
  status: "ok" as const,
};

function parseCustomer(overrides: Record<string, unknown>) {
  return upsertCustomerInputSchema.parse({ ...validCustomer, ...overrides });
}

function nestedMetadata(depth: number): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let cursor = root;

  for (let level = 0; level < depth; level += 1) {
    const next: Record<string, unknown> = {};
    cursor.child = next;
    cursor = next;
  }

  return root;
}

describe("upsertCustomerInputSchema", () => {
  it("canonicalises the folder path", () => {
    const result = upsertCustomerInputSchema.parse({
      ...validCustomer,
      folderPath: "./customers/../customers/c-001/",
    });

    expect(result.folderPath).toBe(path.resolve("./customers/c-001"));
  });

  it("rejects a folder path containing NUL", () => {
    expect(() =>
      parseCustomer({ folderPath: "/customers/\u0000bad" })
    ).toThrow();
  });

  it("rejects an over-long folder path", () => {
    expect(() =>
      parseCustomer({ folderPath: `/${"a".repeat(4096)}` })
    ).toThrow();
  });

  it("truncates fractional modification times", () => {
    const result = parseCustomer({ folderMtimeMs: 1_793_260_675_839.87 });

    expect(result.folderMtimeMs).toBe(1_793_260_675_839);
  });

  it("accepts modification time boundaries", () => {
    expect(parseCustomer({ folderMtimeMs: 0 }).folderMtimeMs).toBe(0);
    expect(
      parseCustomer({ folderMtimeMs: Number.MAX_SAFE_INTEGER }).folderMtimeMs
    ).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["a negative value", -1],
    ["a value beyond the safe integer range", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects %s as folderMtimeMs", (_label, folderMtimeMs) => {
    expect(() => parseCustomer({ folderMtimeMs })).toThrow();
  });

  it("accepts structured metadata", () => {
    const result = parseCustomer({
      metadataJson: { articles: 12, revisions: 3 },
    });

    expect(result.metadataJson).toEqual({ articles: 12, revisions: 3 });
  });

  it("accepts explicitly null optional fields", () => {
    const result = parseCustomer({
      metadataJson: null,
      name: null,
      schemaVersion: null,
    });

    expect(result.metadataJson).toBeNull();
    expect(result.name).toBeNull();
    expect(result.schemaVersion).toBeNull();
  });

  it("rejects metadata that is not an object", () => {
    expect(() => parseCustomer({ metadataJson: "not-json" })).toThrow();
  });

  it("rejects array metadata", () => {
    expect(() => parseCustomer({ metadataJson: [1, 2, 3] })).toThrow();
  });

  it("accepts metadata nested up to the depth limit", () => {
    expect(() =>
      parseCustomer({ metadataJson: nestedMetadata(8) })
    ).not.toThrow();
  });

  it("rejects metadata nested beyond the depth limit", () => {
    expect(() => parseCustomer({ metadataJson: nestedMetadata(9) })).toThrow();
  });

  it("accepts metadata within the node budget", () => {
    expect(() =>
      parseCustomer({
        metadataJson: {
          list: Array.from({ length: 100 }, (_, index) => index),
        },
      })
    ).not.toThrow();
  });

  it("rejects metadata with too many nodes", () => {
    expect(() =>
      parseCustomer({
        metadataJson: {
          list: Array.from({ length: 1000 }, (_, index) => index),
        },
      })
    ).toThrow();
  });

  it("rejects metadata larger than 64 KiB", () => {
    expect(() =>
      parseCustomer({ metadataJson: { blob: "x".repeat(64 * 1024) } })
    ).toThrow();
  });

  it("rejects circular metadata", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => parseCustomer({ metadataJson: circular })).toThrow();
  });

  it("normalises whitespace-only names to null", () => {
    expect(parseCustomer({ name: "" }).name).toBeNull();
    expect(parseCustomer({ name: "   " }).name).toBeNull();
    expect(parseCustomer({ name: "  Mario  " }).name).toBe("Mario");
  });

  it("keeps null and undefined names distinct", () => {
    expect(parseCustomer({ name: null }).name).toBeNull();
    expect(parseCustomer({}).name).toBeUndefined();
  });

  it("rejects unknown keys", () => {
    expect(() => parseCustomer({ misspelledName: "Mario" })).toThrow();
  });

  it("rejects a whitespace-only customer code", () => {
    expect(() => parseCustomer({ customerCode: "   " })).toThrow();
  });

  it("enforces maximum lengths", () => {
    expect(parseCustomer({ customerCode: "x".repeat(128) })).toBeTruthy();
    expect(parseCustomer({ folderName: "x".repeat(256) })).toBeTruthy();
    expect(parseCustomer({ name: "x".repeat(256) })).toBeTruthy();

    expect(() => parseCustomer({ customerCode: "x".repeat(129) })).toThrow();
    expect(() => parseCustomer({ folderName: "x".repeat(257) })).toThrow();
    expect(() => parseCustomer({ name: "x".repeat(257) })).toThrow();
  });

  it("rejects an unsupported status", () => {
    expect(() => parseCustomer({ status: "pending" })).toThrow();
  });
});

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

  it("caps the page size", () => {
    expect(() => listCustomersInputSchema.parse({ limit: 501 })).toThrow();
  });

  it("rejects unknown keys", () => {
    expect(() => listCustomersInputSchema.parse({ searchh: "acme" })).toThrow();
  });
});
