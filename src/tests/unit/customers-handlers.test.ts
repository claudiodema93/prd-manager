import path from "node:path";
import { call } from "@orpc/server";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

// Derive the database type locally so this test does not depend on the name of
// the type exported by `@/db` (it is renamed by another change in flight).
const schema = { customers };
type TestDatabase = ReturnType<typeof drizzle<typeof schema>>;

const acme = {
  customerCode: "ACME-001",
  folderMtimeMs: 1_793_260_675_839,
  folderName: "Acme Srl",
  folderPath: path.resolve("/customers/acme"),
  status: "ok" as const,
};

function makeCustomer(
  overrides: Partial<typeof acme> & { folderPath: string }
) {
  return { ...acme, ...overrides };
}

let sqlite: Database.Database;

beforeEach(() => {
  sqlite = new Database(":memory:");
  const database: TestDatabase = drizzle({
    client: sqlite,
    schema,
  });
  migrate(database, {
    migrationsFolder: path.resolve(import.meta.dirname, "../../../drizzle"),
  });
  state.db = database;
});

afterEach(() => {
  sqlite.close();
});

describe("customers handlers", () => {
  it("inserts and reads a customer with numeric timestamps", async () => {
    const created = await call(upsertCustomer, acme);
    const customer = await call(getCustomer, { folderPath: acme.folderPath });

    expect(customer).toMatchObject({
      customerCode: "ACME-001",
      folderName: "Acme Srl",
      folderPath: acme.folderPath,
      status: "ok",
    });
    expect(typeof created?.createdAt).toBe("number");
    expect(typeof created?.updatedAt).toBe("number");
    expect(typeof customer?.createdAt).toBe("number");
    expect(typeof customer?.updatedAt).toBe("number");
  });

  it("returns null when reading a missing customer", async () => {
    await expect(
      call(getCustomer, { folderPath: "/customers/missing" })
    ).resolves.toBeNull();
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

  it("preserves createdAt and bumps updatedAt on re-upsert", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });

    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const first = await call(upsertCustomer, acme);

      vi.setSystemTime(new Date("2026-01-01T00:00:05.000Z"));
      const second = await call(upsertCustomer, {
        ...acme,
        customerCode: "ACME-002",
      });

      expect(typeof first?.createdAt).toBe("number");
      expect(typeof second?.createdAt).toBe("number");
      expect(typeof second?.updatedAt).toBe("number");
      expect(second?.createdAt).toBe(first?.createdAt);
      expect(second?.createdAt).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
      expect(second?.updatedAt).toBe(Date.parse("2026-01-01T00:00:05.000Z"));
      expect(second?.updatedAt).toBeGreaterThan(second?.createdAt ?? 0);
      expect(second?.customerCode).toBe("ACME-002");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a single row when the same customer is upserted twice", async () => {
    await call(upsertCustomer, acme);
    await call(upsertCustomer, { ...acme, folderMtimeMs: 2 });

    const result = await call(listCustomers, {});

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.items[0]?.folderMtimeMs).toBe(2);
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

  it("matches non-ASCII text regardless of case", async () => {
    await call(upsertCustomer, {
      ...acme,
      customerCode: "MÜLLER GmbH",
      folderName: "Müller",
      folderPath: "/customers/mueller",
    });
    await call(upsertCustomer, {
      ...acme,
      customerCode: "ÅNGSTRÖM",
      folderName: "Ångström",
      folderPath: "/customers/angstrom",
    });

    const mueller = await call(listCustomers, { search: "müller" });
    const angstrom = await call(listCustomers, { search: "ångström" });
    const upper = await call(listCustomers, { search: "MÜLLER" });

    expect(mueller.items.map((item) => item.customerCode)).toEqual([
      "MÜLLER GmbH",
    ]);
    expect(angstrom.items.map((item) => item.customerCode)).toEqual([
      "ÅNGSTRÖM",
    ]);
    expect(upper.items.map((item) => item.customerCode)).toEqual([
      "MÜLLER GmbH",
    ]);
  });

  it("matches composed and decomposed Unicode spellings", async () => {
    const composed = "Müller";
    const decomposed = composed.normalize("NFD");

    // Store one row in each Unicode form and search using both.
    await call(upsertCustomer, {
      ...acme,
      customerCode: "NFD-001",
      folderName: decomposed,
      folderPath: "/customers/nfd",
    });
    await call(upsertCustomer, {
      ...acme,
      customerCode: "NFC-001",
      folderName: composed,
      folderPath: "/customers/nfc",
    });

    const viaComposed = await call(listCustomers, { search: composed });
    const viaDecomposed = await call(listCustomers, { search: decomposed });

    expect(viaComposed.items.map((item) => item.customerCode)).toEqual([
      "NFC-001",
      "NFD-001",
    ]);
    expect(viaDecomposed.items.map((item) => item.customerCode)).toEqual([
      "NFC-001",
      "NFD-001",
    ]);
  });

  it("keeps a stored name searchable after a partial upsert", async () => {
    await call(upsertCustomer, { ...acme, name: "Mario" });
    await call(upsertCustomer, { ...acme, folderMtimeMs: 2 });

    const result = await call(listCustomers, { search: "mario" });

    expect(result.items.map((item) => item.customerCode)).toEqual(["ACME-001"]);
  });

  it("searches by code even when the name is NULL", async () => {
    await call(upsertCustomer, acme);

    const result = await call(listCustomers, { search: "acme-001" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.name).toBeNull();
  });

  it("treats LIKE wildcards and backslashes literally", async () => {
    await call(upsertCustomer, {
      ...acme,
      customerCode: "PERCENT%CODE",
      folderName: "Percent",
      folderPath: "/customers/percent",
    });
    await call(upsertCustomer, {
      ...acme,
      customerCode: "PERCENTXCODE",
      folderName: "PercentX",
      folderPath: "/customers/percentx",
    });
    await call(upsertCustomer, {
      ...acme,
      customerCode: "UNDER_SCORE",
      folderName: "Underscore",
      folderPath: "/customers/underscore",
    });
    await call(upsertCustomer, {
      ...acme,
      customerCode: "UNDERXSCORE",
      folderName: "UnderscoreX",
      folderPath: "/customers/underscorex",
    });
    await call(upsertCustomer, {
      ...acme,
      customerCode: "BACK\\SLASH",
      folderName: "Backslash",
      folderPath: "/customers/backslash",
    });

    const percent = await call(listCustomers, { search: "%" });
    const underscore = await call(listCustomers, { search: "_" });
    const backslash = await call(listCustomers, { search: "\\" });

    expect(percent.items.map((item) => item.customerCode)).toEqual([
      "PERCENT%CODE",
    ]);
    expect(underscore.items.map((item) => item.customerCode)).toEqual([
      "UNDER_SCORE",
    ]);
    expect(backslash.items.map((item) => item.customerCode)).toEqual([
      "BACK\\SLASH",
    ]);
  });

  it("filters by status and search together", async () => {
    await call(upsertCustomer, {
      ...acme,
      customerCode: "SHARED-OK",
      folderName: "Shared",
      folderPath: "/customers/shared-ok",
    });
    await call(upsertCustomer, {
      ...acme,
      customerCode: "SHARED-WARN",
      folderName: "Shared",
      folderPath: "/customers/shared-warn",
      status: "warning",
    });

    const result = await call(listCustomers, {
      search: "shared",
      status: "warning",
    });

    expect(result.items.map((item) => item.customerCode)).toEqual([
      "SHARED-WARN",
    ]);
    expect(result.total).toBe(1);
  });

  it("orders results deterministically by code, folder name and path", async () => {
    await Promise.all(
      ["/customers/zeta", "/customers/alpha", "/customers/middle"].map(
        (folderPath) =>
          call(upsertCustomer, {
            ...acme,
            customerCode: "SAME-001",
            folderName: "Same",
            folderPath,
          })
      )
    );

    const paths = (await call(listCustomers, {})).items.map(
      (item) => item.folderPath
    );

    expect(paths).toEqual([
      path.resolve("/customers/alpha"),
      path.resolve("/customers/middle"),
      path.resolve("/customers/zeta"),
    ]);
  });

  it("omits metadata from list results but returns it on get", async () => {
    await call(upsertCustomer, {
      ...acme,
      metadataJson: { articles: 2 },
    });

    const list = await call(listCustomers, {});
    const detail = await call(getCustomer, { folderPath: acme.folderPath });

    expect(list.items[0]).not.toHaveProperty("metadataJson");
    expect(detail?.metadataJson).toEqual({ articles: 2 });
  });

  it("returns an empty page past the end with the full total", async () => {
    await call(upsertCustomer, acme);
    await call(upsertCustomer, {
      ...acme,
      customerCode: "BETA-001",
      folderPath: "/customers/beta",
    });

    const page = await call(listCustomers, { limit: 2, offset: 10 });

    expect(page.items).toEqual([]);
    expect(page.total).toBe(2);
  });

  it("keeps total independent of limit", async () => {
    await call(upsertCustomer, acme);
    await call(upsertCustomer, {
      ...acme,
      customerCode: "BETA-001",
      folderPath: "/customers/beta",
    });
    await call(upsertCustomer, {
      ...acme,
      customerCode: "GAMMA-001",
      folderPath: "/customers/gamma",
    });

    const one = await call(listCustomers, { limit: 1 });
    const all = await call(listCustomers, { limit: 500 });

    expect(one.items).toHaveLength(1);
    expect(one.total).toBe(3);
    expect(all.items).toHaveLength(3);
    expect(all.total).toBe(3);
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

  it("returns zero when clearing an empty table", async () => {
    await expect(call(clearCustomers, undefined)).resolves.toBe(0);
  });

  it("removes and clears customers", async () => {
    await call(upsertCustomer, acme);

    await expect(
      call(removeCustomer, { folderPath: acme.folderPath })
    ).resolves.toBe(acme.folderPath);

    await call(upsertCustomer, acme);
    await call(
      upsertCustomer,
      makeCustomer({
        customerCode: "BETA-001",
        folderPath: "/customers/beta",
      })
    );

    await expect(call(clearCustomers, undefined)).resolves.toBe(2);
    expect((await call(listCustomers, {})).total).toBe(0);
  });
});
