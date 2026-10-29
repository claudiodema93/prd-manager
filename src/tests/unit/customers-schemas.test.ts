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

describe("upsertCustomerInputSchema", () => {
  it("canonicalises the folder path", () => {
    const result = upsertCustomerInputSchema.parse({
      ...validCustomer,
      folderPath: "./customers/../customers/c-001/",
    });

    expect(result.folderPath).toBe(path.resolve("./customers/c-001"));
  });

  it("truncates fractional modification times", () => {
    const result = upsertCustomerInputSchema.parse({
      ...validCustomer,
      folderMtimeMs: 1_793_260_675_839.87,
    });

    expect(result.folderMtimeMs).toBe(1_793_260_675_839);
  });

  it("accepts structured metadata", () => {
    const result = upsertCustomerInputSchema.parse({
      ...validCustomer,
      metadataJson: { articles: 12, revisions: 3 },
    });

    expect(result.metadataJson).toEqual({ articles: 12, revisions: 3 });
  });

  it("accepts explicitly null optional fields", () => {
    const result = upsertCustomerInputSchema.parse({
      ...validCustomer,
      metadataJson: null,
      name: null,
      schemaVersion: null,
    });

    expect(result.metadataJson).toBeNull();
    expect(result.name).toBeNull();
    expect(result.schemaVersion).toBeNull();
  });

  it("rejects metadata that is not an object", () => {
    expect(() =>
      upsertCustomerInputSchema.parse({
        ...validCustomer,
        metadataJson: "not-json",
      })
    ).toThrow();
  });

  it("rejects an unsupported status", () => {
    expect(() =>
      upsertCustomerInputSchema.parse({ ...validCustomer, status: "pending" })
    ).toThrow();
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

  it("caps the page size", () => {
    expect(() => listCustomersInputSchema.parse({ limit: 501 })).toThrow();
  });
});
