import path from "node:path";
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
import { ipcContext } from "@/ipc/context";
import { router } from "@/ipc/router";

/**
 * Exercises the production router over a real MessagePort pair with the same
 * oRPC peers the app uses. Unlike the transport tests, nothing is rebuilt here:
 * the app/router imports exactly what `src/main.ts` loads.
 */

const electronState = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  systemDark: false,
  themeSource: "system" as "light" | "dark" | "system",
}));

vi.mock("electron", () => ({
  app: {
    getVersion: () => "1.4.1",
  },
  dialog: {
    showOpenDialog: electronState.showOpenDialog,
  },
  nativeTheme: {
    get shouldUseDarkColors() {
      return electronState.systemDark;
    },
    get themeSource() {
      return electronState.themeSource;
    },
    set themeSource(value: "light" | "dark" | "system") {
      electronState.themeSource = value;
      // Model Electron: an explicit source drives the resolved appearance.
      electronState.systemDark = value === "dark";
    },
  },
  shell: {
    openExternal: vi.fn(async () => undefined),
  },
}));

const preferencesState = vi.hoisted(() => ({
  language: "en" as "en" | "pt-BR",
  setTheme: vi.fn(),
}));

vi.mock("@/preferences/store", () => ({
  getLanguagePreference: () => preferencesState.language,
  setLanguagePreference: (language: "en" | "pt-BR") => {
    preferencesState.language = language;
  },
  setThemePreference: preferencesState.setTheme,
}));

const state = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/db", () => ({
  getDatabase: () => state.db,
}));

const schema = { customers: customersTable };
type TestDatabase = ReturnType<typeof drizzle<typeof schema>>;
type TestClient = RouterClient<typeof router>;

const migrationsFolder = path.resolve(import.meta.dirname, "../../../drizzle");

let sqlite: Database.Database;
let client: TestClient;
let clientPort: MessageChannel["port1"];
let serverPort: MessageChannel["port2"];

beforeEach(() => {
  electronState.themeSource = "system";
  electronState.systemDark = false;
  electronState.showOpenDialog.mockReset();
  electronState.showOpenDialog.mockResolvedValue({
    canceled: false,
    filePaths: ["/tmp/picked.txt"],
  });
  preferencesState.language = "en";
  preferencesState.setTheme.mockReset();

  sqlite = new Database(":memory:");
  const database: TestDatabase = drizzle({ client: sqlite, schema });

  migrate(database, { migrationsFolder });
  state.db = database;

  const channel = new MessageChannel();
  clientPort = channel.port1;
  serverPort = channel.port2;

  new RPCHandler(router).upgrade(serverPort);
  client = createORPCClient<TestClient>(new RPCLink({ port: clientPort }));

  clientPort.start();
  serverPort.start();
});

afterEach(() => {
  clientPort.close();
  serverPort.close();
  ipcContext.mainWindow = undefined;
  sqlite.close();
});

describe("production IPC router", () => {
  it("serves customers.listCustomers over the wire", async () => {
    const page = await client.customers.listCustomers({});

    expect(page).toEqual({ items: [], total: 0 });
  });

  it("preserves ORPC error codes across the transport", async () => {
    await expect(
      client.customers.removeCustomer({
        folderPath: path.resolve("/customers/missing"),
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("runs a window procedure against the context window", async () => {
    const window = {
      close: vi.fn(),
      isMaximized: vi.fn(() => false),
      maximize: vi.fn(),
      minimize: vi.fn(),
      unmaximize: vi.fn(),
    };

    ipcContext.setMainWindow(
      window as unknown as Parameters<typeof ipcContext.setMainWindow>[0]
    );

    await client.window.minimizeWindow();

    expect(window.minimize).toHaveBeenCalledTimes(1);
  });

  it("returns the theme state shape the renderer expects", async () => {
    const theme = await client.theme.getCurrentThemeMode();

    expect(theme).toEqual({ dark: false, source: "system" });
  });

  it("serves and persists preferences over the wire", async () => {
    await expect(client.preferences.getPreferences()).resolves.toEqual({
      language: "en",
      theme: "system",
    });

    await expect(
      client.preferences.setLanguage({ language: "pt-BR" })
    ).resolves.toEqual({ language: "pt-BR", theme: "system" });

    await expect(client.preferences.getPreferences()).resolves.toEqual({
      language: "pt-BR",
      theme: "system",
    });
  });

  it("persists theme changes made through the theme namespace", async () => {
    await client.theme.setThemeMode({ mode: "dark" });

    expect(preferencesState.setTheme).toHaveBeenCalledWith("dark");
  });

  it("serves the dialog namespace over the wire", async () => {
    const window = {
      close: vi.fn(),
      isMaximized: vi.fn(() => false),
      maximize: vi.fn(),
      minimize: vi.fn(),
      unmaximize: vi.fn(),
    };

    ipcContext.setMainWindow(
      window as unknown as Parameters<typeof ipcContext.setMainWindow>[0]
    );

    await expect(client.dialog.openFile({ multiple: true })).resolves.toEqual({
      canceled: false,
      filePaths: ["/tmp/picked.txt"],
    });

    expect(electronState.showOpenDialog).toHaveBeenCalledWith(
      window,
      expect.objectContaining({
        properties: ["openFile", "multiSelections"],
      })
    );

    await expect(
      client.dialog.openDirectory({ multiple: true })
    ).resolves.toEqual({
      canceled: false,
      filePaths: ["/tmp/picked.txt"],
    });

    expect(electronState.showOpenDialog).toHaveBeenCalledWith(
      window,
      expect.objectContaining({
        properties: ["openDirectory", "multiSelections"],
      })
    );

    await expect(
      client.dialog.openFile({ properties: ["openFile"] } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
