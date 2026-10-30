import { call, ORPCError } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appVersion, currentPlatfom } from "@/ipc/app/handlers";
import { ipcContext } from "@/ipc/context";
import { logRpcError } from "@/ipc/handler";
import {
  getFolders,
  getPreferences,
  setFolder,
  setLanguage,
} from "@/ipc/preferences/handlers";
import { openExternalLink } from "@/ipc/shell/handlers";
import {
  getCurrentThemeMode,
  setThemeMode,
  toggleThemeMode,
} from "@/ipc/theme/handlers";
import {
  closeWindow,
  maximizeWindow,
  minimizeWindow,
} from "@/ipc/window/hadlers";

const RPC_FAILURE_PREFIX = /^\[ipc\] RPC call failed\. /u;

/**
 * Direct handler tests. The transport is covered elsewhere; here the procedures
 * are invoked in-process so every branch of the window/theme/app/shell logic is
 * exercised with a controlled Electron mock.
 */

const electronState = vi.hoisted(() => ({
  openExternal: vi.fn(),
  systemDark: false,
  themeSource: "system" as "light" | "dark" | "system",
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

vi.mock("electron", () => ({
  app: {
    getVersion: () => "9.9.9",
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
    openExternal: electronState.openExternal,
  },
}));

type ContextWindow = Parameters<typeof ipcContext.setMainWindow>[0];

function makeWindow(isMaximized = false) {
  return {
    close: vi.fn(),
    isMaximized: vi.fn(() => isMaximized),
    maximize: vi.fn(),
    minimize: vi.fn(),
    unmaximize: vi.fn(),
  };
}

beforeEach(() => {
  electronState.themeSource = "system";
  electronState.systemDark = false;
  electronState.openExternal.mockReset();
  electronState.openExternal.mockResolvedValue(undefined);
  preferencesState.folders = {
    articlesDirectory: null,
    issuesDirectory: null,
    trashDirectory: null,
  };
  preferencesState.language = "it";
  preferencesState.setLanguage.mockReset();
  preferencesState.setTheme.mockReset();
});

afterEach(() => {
  ipcContext.mainWindow = undefined;
  vi.restoreAllMocks();
});

describe("window handlers", () => {
  it("minimizes the context window", async () => {
    const window = makeWindow();
    ipcContext.setMainWindow(window as unknown as ContextWindow);

    await call(minimizeWindow, undefined);

    expect(window.minimize).toHaveBeenCalledTimes(1);
  });

  it("closes the context window", async () => {
    const window = makeWindow();
    ipcContext.setMainWindow(window as unknown as ContextWindow);

    await call(closeWindow, undefined);

    expect(window.close).toHaveBeenCalledTimes(1);
  });

  it("maximizes a window that is not maximized", async () => {
    const window = makeWindow(false);
    ipcContext.setMainWindow(window as unknown as ContextWindow);

    await call(maximizeWindow, undefined);

    expect(window.maximize).toHaveBeenCalledTimes(1);
    expect(window.unmaximize).not.toHaveBeenCalled();
  });

  it("unmaximizes a window that is maximized", async () => {
    const window = makeWindow(true);
    ipcContext.setMainWindow(window as unknown as ContextWindow);

    await call(maximizeWindow, undefined);

    expect(window.unmaximize).toHaveBeenCalledTimes(1);
    expect(window.maximize).not.toHaveBeenCalled();
  });

  it("rejects when no main window is set in the IPC context", async () => {
    ipcContext.mainWindow = undefined;

    await expect(call(minimizeWindow, undefined)).rejects.toThrow(
      "Main window is not set in IPC context."
    );
  });
});

describe("theme handlers", () => {
  it("reports the current source and resolved darkness", async () => {
    electronState.themeSource = "system";
    electronState.systemDark = false;

    await expect(call(getCurrentThemeMode, undefined)).resolves.toEqual({
      dark: false,
      source: "system",
    });
  });

  it("sets an explicit light theme", async () => {
    await expect(call(setThemeMode, { mode: "light" })).resolves.toEqual({
      dark: false,
      source: "light",
    });
    expect(electronState.themeSource).toBe("light");
    expect(preferencesState.setTheme).toHaveBeenCalledWith("light");
  });

  it("sets an explicit dark theme", async () => {
    await expect(call(setThemeMode, { mode: "dark" })).resolves.toEqual({
      dark: true,
      source: "dark",
    });
    expect(electronState.themeSource).toBe("dark");
  });

  it("can return to the system theme", async () => {
    await call(setThemeMode, { mode: "dark" });

    await expect(call(setThemeMode, { mode: "system" })).resolves.toEqual({
      dark: false,
      source: "system",
    });
    expect(electronState.themeSource).toBe("system");
  });

  it("toggles from light to dark and back", async () => {
    await call(setThemeMode, { mode: "light" });

    await expect(call(toggleThemeMode, undefined)).resolves.toEqual({
      dark: true,
      source: "dark",
    });

    await expect(call(toggleThemeMode, undefined)).resolves.toEqual({
      dark: false,
      source: "light",
    });
    expect(preferencesState.setTheme).toHaveBeenLastCalledWith("light");
  });

  it("rejects an unsupported theme mode", async () => {
    await expect(
      call(setThemeMode, { mode: "purple" as unknown as "light" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(electronState.themeSource).toBe("system");
  });
});

describe("preferences handlers", () => {
  it("returns the stored language and the current theme", async () => {
    preferencesState.language = "it";
    electronState.themeSource = "dark";

    await expect(call(getPreferences, undefined)).resolves.toEqual({
      language: "it",
      theme: "dark",
    });
  });

  it("persists a supported language", async () => {
    await expect(call(setLanguage, { language: "it" })).resolves.toEqual({
      language: "it",
      theme: "system",
    });

    expect(preferencesState.language).toBe("it");
    // The state already starts as "it", so only the call proves persistence.
    expect(preferencesState.setLanguage).toHaveBeenCalledWith("it");
  });

  it("rejects an unsupported language without persisting it", async () => {
    await expect(
      call(setLanguage, { language: "en" as unknown as "it" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(preferencesState.language).toBe("it");
    expect(preferencesState.setLanguage).not.toHaveBeenCalled();
  });
});

describe("folder handlers", () => {
  it("returns the stored folders", async () => {
    preferencesState.folders.articlesDirectory = "/tmp/articles";

    await expect(call(getFolders, undefined)).resolves.toEqual({
      articlesDirectory: "/tmp/articles",
      issuesDirectory: null,
      trashDirectory: null,
    });
  });

  it("persists a folder and returns the updated set", async () => {
    await expect(
      call(setFolder, {
        directory: "/tmp/articles",
        key: "articlesDirectory",
      })
    ).resolves.toEqual({
      articlesDirectory: "/tmp/articles",
      issuesDirectory: null,
      trashDirectory: null,
    });

    expect(preferencesState.folders.articlesDirectory).toBe("/tmp/articles");
  });

  it("rejects a relative folder path without persisting it", async () => {
    await expect(
      call(setFolder, {
        directory: "relative/articles",
        key: "articlesDirectory",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(preferencesState.folders.articlesDirectory).toBeNull();
  });
});

describe("app handlers", () => {
  it("reports the running platform", async () => {
    await expect(call(currentPlatfom, undefined)).resolves.toBe(
      process.platform
    );
  });

  it("reports the application version", async () => {
    await expect(call(appVersion, undefined)).resolves.toBe("9.9.9");
  });
});

describe("shell handler", () => {
  it("opens a validated external URL and returns it", async () => {
    const url = "https://example.com/docs?q=1";

    await expect(call(openExternalLink, { url })).resolves.toBe(url);
    expect(electronState.openExternal).toHaveBeenCalledWith(url);
  });

  it("turns a failed open into BAD_REQUEST", async () => {
    electronState.openExternal.mockRejectedValueOnce(
      new Error("no handler registered")
    );

    await expect(
      call(openExternalLink, { url: "https://example.com" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("logRpcError", () => {
  it("logs expected 4xx ORPC errors at debug level", () => {
    const debug = vi
      .spyOn(console, "debug")
      .mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    logRpcError(new ORPCError("NOT_FOUND"));

    expect(debug).toHaveBeenCalledWith("[ipc] RPC returned NOT_FOUND (404).");
    expect(error).not.toHaveBeenCalled();
  });

  it("logs unexpected errors as name and message only", () => {
    const debug = vi
      .spyOn(console, "debug")
      .mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    logRpcError(new TypeError("database exploded with secret"));

    expect(debug).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "[ipc] RPC call failed. TypeError: database exploded with secret"
    );
  });

  it("logs a non-Error throw without leaking its value", () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    logRpcError("plain string");

    expect(error).toHaveBeenCalledWith(
      "[ipc] RPC call failed. string: Non-Error thrown"
    );
  });

  it("treats 5xx ORPC errors as unexpected failures", () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const debug = vi
      .spyOn(console, "debug")
      .mockImplementation(() => undefined);

    logRpcError(new ORPCError("INTERNAL_SERVER_ERROR"));

    expect(debug).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toMatch(RPC_FAILURE_PREFIX);
  });
});
