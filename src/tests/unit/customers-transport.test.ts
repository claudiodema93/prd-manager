import { MessageChannel } from "node:worker_threads";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import type { RouterClient } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { customers as customersTable } from "@/db/schema";
import { customers } from "@/ipc/customers";

const state = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/db", () => ({
  getDatabase: () => state.db,
}));

const schema = { customers: customersTable };
type TestDatabase = ReturnType<typeof drizzle<typeof schema>>;

const testRouter = { customers };
type TestClient = RouterClient<typeof testRouter>;

const customerInput = {
  customerCode: "TRANSPORT-001",
  folderMtimeMs: 1_793_260_675_839,
  folderName: "Transport Srl",
  folderPath: "/customers/transport",
  metadataJson: { articles: 2 },
  status: "ok" as const,
};

let sqlite: Database.Database;
let client: TestClient;
let clientPort: MessageChannel["port1"];
let serverPort: MessageChannel["port2"];

beforeEach(() => {
  sqlite = new Database(":memory:");
  const database: TestDatabase = drizzle({ client: sqlite, schema });
  migrate(database, { migrationsFolder: "./drizzle" });
  state.db = database;

  const channel = new MessageChannel();
  clientPort = channel.port1;
  serverPort = channel.port2;

  // The real oRPC peers: RPC handler on the server port, RPC link on the
  // client port, exactly as Electron wires them up in main/preload/renderer.
  new RPCHandler(testRouter).upgrade(serverPort);
  client = createORPCClient<TestClient>(new RPCLink({ port: clientPort }));

  clientPort.start();
  serverPort.start();
});

afterEach(() => {
  clientPort.close();
  serverPort.close();
  sqlite.close();
});

describe("customers transport", () => {
  it("round-trips timestamps as numbers, not strings", async () => {
    const created = await client.customers.upsertCustomer(customerInput);

    expect(typeof created.createdAt).toBe("number");
    expect(typeof created.updatedAt).toBe("number");
    expect(created.createdAt).toBeGreaterThan(0);
    expect(created.updatedAt).toBeGreaterThan(0);
  });

  it("keeps list, get and upsert payloads JSON-safe", async () => {
    const created = await client.customers.upsertCustomer(customerInput);

    expect(JSON.parse(JSON.stringify(created))).toEqual(created);

    const detail = await client.customers.getCustomer({
      folderPath: customerInput.folderPath,
    });

    expect(detail).not.toBeNull();
    expect(detail?.metadataJson).toEqual({ articles: 2 });
    expect(typeof detail?.createdAt).toBe("number");
    expect(typeof detail?.updatedAt).toBe("number");
    expect(JSON.parse(JSON.stringify(detail))).toEqual(detail);

    const list = await client.customers.listCustomers({});

    expect(list.total).toBe(1);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).not.toHaveProperty("metadataJson");
    expect(typeof list.items[0]?.createdAt).toBe("number");
    expect(typeof list.items[0]?.updatedAt).toBe("number");
    expect(JSON.parse(JSON.stringify(list))).toEqual(list);
  });

  it("round-trips remove and clear", async () => {
    await client.customers.upsertCustomer(customerInput);

    await expect(
      client.customers.removeCustomer({ folderPath: customerInput.folderPath })
    ).resolves.toBe(customerInput.folderPath);

    await expect(client.customers.clearCustomers()).resolves.toBe(0);
  });
});
