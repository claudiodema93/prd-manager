import fs from "node:fs/promises";
import os from "node:os";
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
  folders: {
    articlesDirectory: null as string | null,
    issuesDirectory: null as string | null,
    trashDirectory: null as string | null,
  },
  language: "it" as const,
  setLanguage: vi.fn(),
  setTheme: vi.fn(),
}));

vi.mock("@/preferences/store", () => ({
  getFoldersPreference: () => ({ ...preferencesState.folders }),
  getLanguagePreference: () => preferencesState.language,
  setFolderPreference: (
    key: "articlesDirectory" | "issuesDirectory" | "trashDirectory",
    directory: string | null
  ) => {
    preferencesState.folders = {
      ...preferencesState.folders,
      [key]: directory,
    };
  },
  setLanguagePreference: (language: "it") => {
    preferencesState.setLanguage(language);
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

interface TestParameters {
  readonly [name: string]: {
    readonly default?: string;
    readonly required: boolean;
    readonly type: "bool" | "number" | "text";
  };
}

interface TestSection {
  readonly key: string;
  readonly parameters: TestParameters;
  readonly schemaVersion: number;
}

const ARTICLE_SECTION: TestSection = {
  key: "{CODE}[_EVO{EVO:00}]",
  parameters: {
    CODE: { required: true, type: "text" },
    EVO: { default: "0", required: true, type: "number" },
  },
  schemaVersion: 1,
};

const REVISION_SECTION: TestSection = {
  key: "REV_{REV}",
  parameters: {
    REV: { default: "0", required: true, type: "number" },
  },
  schemaVersion: 1,
};

const CONFIG_FILE_NAME = "customer_data.json";

const EMPTY_SCAN_RESULT = {
  created: 0,
  issues: [],
  removed: 0,
  root: null,
  scanned: 0,
  unchanged: 0,
  updated: 0,
};

/** Fresh copies so a mutation in one call cannot leak into the next. */
function copySection(section: TestSection): TestSection {
  return {
    key: section.key,
    parameters: { ...section.parameters },
    schemaVersion: section.schemaVersion,
  };
}

function customerInput(name = "Acme") {
  return {
    article: copySection(ARTICLE_SECTION),
    name,
    revision: copySection(REVISION_SECTION),
  };
}

async function makeTempDirectory(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));

  tempDirectories.push(directory);

  return directory;
}

const migrationsFolder = path.resolve(import.meta.dirname, "../../../drizzle");

let sqlite: Database.Database;
let client: TestClient;
let clientPort: MessageChannel["port1"];
let serverPort: MessageChannel["port2"];
let tempDirectories: string[];

beforeEach(() => {
  electronState.themeSource = "system";
  electronState.systemDark = false;
  electronState.showOpenDialog.mockReset();
  electronState.showOpenDialog.mockResolvedValue({
    canceled: false,
    filePaths: ["/tmp/picked.txt"],
  });
  preferencesState.folders = {
    articlesDirectory: null,
    issuesDirectory: null,
    trashDirectory: null,
  };
  preferencesState.language = "it";
  preferencesState.setLanguage.mockReset();
  preferencesState.setTheme.mockReset();

  tempDirectories = [];

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

afterEach(async () => {
  clientPort.close();
  serverPort.close();
  ipcContext.mainWindow = undefined;
  sqlite.close();

  await Promise.all(
    tempDirectories.map((directory) =>
      fs.rm(directory, { force: true, recursive: true })
    )
  );
});

describe("production IPC router", () => {
  it("serves customers.listCustomers over the wire", async () => {
    const page = await client.customers.listCustomers({});

    expect(page).toEqual({ items: [], total: 0 });
  });

  it("serves an empty customer scan when no root is configured", async () => {
    await expect(client.customers.scanCustomers({})).resolves.toEqual(
      EMPTY_SCAN_RESULT
    );
  });

  it("rejects removeCustomer before the root check when no root is configured", async () => {
    // The root guard runs before the folder lookup, so an unconfigured root is
    // PRECONDITION_FAILED rather than NOT_FOUND.
    await expect(
      client.customers.removeCustomer({
        folderPath: path.resolve("/customers/missing"),
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("returns null for a customer that is not cached", async () => {
    await expect(
      client.customers.getCustomer({
        folderPath: path.resolve("/customers/missing"),
      })
    ).resolves.toBeNull();
  });

  it("runs the full customer lifecycle against the filesystem and the cache", async () => {
    const articlesDirectory = await makeTempDirectory("ipc-router-customers-");
    const trashDirectory = await makeTempDirectory(
      "ipc-router-customers-trash-"
    );

    preferencesState.folders = {
      articlesDirectory,
      issuesDirectory: null,
      trashDirectory,
    };

    const created = await client.customers.createCustomer(customerInput());

    expect(created).toMatchObject({
      articleCount: 0,
      customerCode: "0001",
      folderName: "customer-0001",
    });

    const { folderPath } = created;
    const listed = await client.customers.listCustomers({});

    expect(listed).toMatchObject({ total: 1 });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({
      articleCount: 0,
      folderName: "customer-0001",
    });
    expect(listed.items[0]).not.toHaveProperty("metadataJson");

    const updated = await client.customers.updateCustomer({
      folderPath,
      name: "Beta",
    });

    expect(updated.name).toBe("Beta");

    const raw = await fs.readFile(
      path.join(folderPath, CONFIG_FILE_NAME),
      "utf8"
    );

    expect(JSON.parse(raw)).toMatchObject({ customerName: "Beta" });

    const detail = await client.customers.getCustomer({ folderPath });

    expect(detail?.name).toBe("Beta");
    expect(detail?.metadataJson?.article?.key).toBe(ARTICLE_SECTION.key);
    expect(detail?.metadataJson?.articleCount).toBe(0);

    await expect(client.customers.removeCustomer({ folderPath })).resolves.toBe(
      folderPath
    );

    await expect(
      fs.lstat(path.join(trashDirectory, "customer-0001"))
    ).resolves.toBeDefined();
    await expect(fs.lstat(folderPath)).rejects.toMatchObject({
      code: "ENOENT",
    });

    await expect(client.customers.listCustomers({})).resolves.toEqual({
      items: [],
      total: 0,
    });
    await expect(client.customers.clearCustomers()).resolves.toBe(0);
  });

  it("clears the cached customers when the articles root changes", async () => {
    const firstRoot = await makeTempDirectory("ipc-router-customers-first-");
    const secondRoot = await makeTempDirectory("ipc-router-customers-second-");
    const trashDirectory = await makeTempDirectory(
      "ipc-router-customers-trash-"
    );

    preferencesState.folders = {
      articlesDirectory: firstRoot,
      issuesDirectory: null,
      trashDirectory,
    };

    await client.customers.createCustomer(customerInput());

    await expect(client.customers.listCustomers({})).resolves.toMatchObject({
      total: 1,
    });

    await client.preferences.setFolder({
      directory: secondRoot,
      key: "articlesDirectory",
    });

    // Rows from the old root must not linger; the next scan rebuilds the cache.
    await expect(client.customers.listCustomers({})).resolves.toEqual({
      items: [],
      total: 0,
    });
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
      language: "it",
      theme: "system",
    });

    await expect(
      client.preferences.setLanguage({ language: "it" })
    ).resolves.toEqual({ language: "it", theme: "system" });

    await expect(client.preferences.getPreferences()).resolves.toEqual({
      language: "it",
      theme: "system",
    });

    // The stored value never changes with a single locale, so the call itself
    // is what proves persistence.
    expect(preferencesState.setLanguage).toHaveBeenCalledWith("it");

    await expect(
      client.preferences.setLanguage({ language: "en" } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(preferencesState.setLanguage).toHaveBeenCalledTimes(1);
  });

  it("serves and persists folders over the wire", async () => {
    const emptyFolders = {
      articlesDirectory: null,
      issuesDirectory: null,
      trashDirectory: null,
    };

    await expect(client.preferences.getFolders()).resolves.toEqual(
      emptyFolders
    );

    await expect(
      client.preferences.setFolder({
        directory: "/tmp/articles",
        key: "articlesDirectory",
      })
    ).resolves.toEqual({
      ...emptyFolders,
      articlesDirectory: "/tmp/articles",
    });

    await expect(client.preferences.getFolders()).resolves.toEqual({
      ...emptyFolders,
      articlesDirectory: "/tmp/articles",
    });

    // Clearing crosses the transport too.
    await expect(
      client.preferences.setFolder({
        directory: null,
        key: "articlesDirectory",
      })
    ).resolves.toEqual(emptyFolders);

    await expect(client.preferences.getFolders()).resolves.toEqual(
      emptyFolders
    );

    // Network shares are valid folder choices.
    await expect(
      client.preferences.setFolder({
        directory: "//server/share",
        key: "articlesDirectory",
      })
    ).resolves.toEqual({
      ...emptyFolders,
      articlesDirectory: "//server/share",
    });

    await Promise.all(
      [
        "relative/articles",
        "",
        "/tmp/artic\u0000les",
        "//?/C:/dir",
        "//./pipe/name",
      ].map((directory) =>
        expect(
          client.preferences.setFolder({
            directory,
            key: "articlesDirectory",
          })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      )
    );

    await expect(
      client.preferences.setFolder({
        directory: "/tmp/articles",
        key: "downloadsDirectory",
      } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Rejected writes must not touch the stored value.
    await expect(client.preferences.getFolders()).resolves.toEqual({
      ...emptyFolders,
      articlesDirectory: "//server/share",
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
