import { call } from "@orpc/server";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SaugerDatabase } from "@/db";
import { customers } from "@/db/schema";
import {
  clearCustomers,
  getCustomer,
  listCustomers,
  removeCustomer,
  upsertCustomer,
} from "@/ipc/customers/handlers";

const state = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/db", () => ({
  getDatabase: () => state.db,
}));

const acme = {
  customerCode: "ACME-001",
  folderMtimeMs: 1_793_260_675_839,
  folderName: "Acme Srl",
  folderPath: "/customers/acme",
  status: "ok" as const,
};

let sqlite: Database.Database;

beforeEach(() => {
  sqlite = new Database(":memory:");
  const database: SaugerDatabase = drizzle({
    client: sqlite,
    schema: { customers },
  });
  migrate(database, { migrationsFolder: "./drizzle" });
  state.db = database;
});

afterEach(() => {
  sqlite.close();
});

describe("customers handlers", () => {
  it("inserts and reads a customer", async () => {
    await call(upsertCustomer, acme);

    const customer = await call(getCustomer, { folderPath: acme.folderPath });

    expect(customer).toMatchObject({
      customerCode: "ACME-001",
      folderName: "Acme Srl",
      folderPath: "/customers/acme",
      status: "ok",
    });
  });

  it("keeps omitted optional fields on a partial upsert", async () => {
    await call(upsertCustomer, {
      ...acme,
      metadataJson: { articles: 12 },
      name: "Mario",
    });

    await call(upsertCustomer, { ...acme, folderMtimeMs: 2 });

    const customer = await call(getCustomer, { folderPath: acme.folderPath });

    expect(customer?.name).toBe("Mario");
    expect(customer?.metadataJson).toEqual({ articles: 12 });
    expect(customer?.folderMtimeMs).toBe(2);
  });

  it("clears a field when null is sent explicitly", async () => {
    await call(upsertCustomer, { ...acme, name: "Mario" });
    await call(upsertCustomer, { ...acme, name: null });

    const customer = await call(getCustomer, { folderPath: acme.folderPath });

    expect(customer?.name).toBeNull();
  });

  it("searches case-insensitively across code, folder and name", async () => {
    await call(upsertCustomer, acme);
    await call(upsertCustomer, {
      ...acme,
      customerCode: "BETA-100%",
      folderName: "Beta",
      folderPath: "/customers/beta",
      name: "ACME Holdings",
    });
    await call(upsertCustomer, {
      ...acme,
      customerCode: "GAMMA",
      folderName: "Gamma",
      folderPath: "/customers/gamma",
      status: "warning",
    });

    const result = await call(listCustomers, { search: " acme " });

    expect(result.items.map((item) => item.customerCode)).toEqual([
      "ACME-001",
      "BETA-100%",
    ]);
    expect(result.total).toBe(2);
  });

  it("filters by status and paginates", async () => {
    await call(upsertCustomer, acme);
    await call(upsertCustomer, {
      ...acme,
      customerCode: "GAMMA",
      folderPath: "/customers/gamma",
      status: "warning",
    });

    const result = await call(listCustomers, { limit: 1, status: "warning" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.customerCode).toBe("GAMMA");
    expect(result.total).toBe(1);
  });

  it("throws NOT_FOUND when removing a missing customer", async () => {
    await expect(
      call(removeCustomer, { folderPath: "/customers/missing" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("removes and clears customers", async () => {
    await call(upsertCustomer, acme);

    await expect(
      call(removeCustomer, { folderPath: acme.folderPath })
    ).resolves.toBe(acme.folderPath);

    await call(upsertCustomer, acme);
    await call(upsertCustomer, {
      ...acme,
      customerCode: "BETA-001",
      folderPath: "/customers/beta",
    });

    await expect(call(clearCustomers, undefined)).resolves.toBe(2);
    expect((await call(listCustomers, {})).total).toBe(0);
  });
});
