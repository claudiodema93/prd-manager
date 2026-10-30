import { call } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ipcContext } from "@/ipc/context";
import { openDirectory, openFile } from "@/ipc/dialog/handlers";

const state = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
}));

vi.mock("electron", () => ({
  dialog: {
    showOpenDialog: state.showOpenDialog,
  },
}));

type ContextWindow = Parameters<typeof ipcContext.setMainWindow>[0];

const window = {
  id: 1,
} as unknown as ContextWindow;

beforeEach(() => {
  state.showOpenDialog.mockReset();
  state.showOpenDialog.mockResolvedValue({
    canceled: false,
    filePaths: ["/tmp/picked.txt"],
  });
  ipcContext.setMainWindow(window);
});

afterEach(() => {
  ipcContext.mainWindow = undefined;
  vi.restoreAllMocks();
});

describe("openFile", () => {
  it("opens a single-file dialog parented to the main window", async () => {
    await expect(call(openFile, {})).resolves.toEqual({
      canceled: false,
      filePaths: ["/tmp/picked.txt"],
    });

    expect(state.showOpenDialog).toHaveBeenCalledWith(window, {
      buttonLabel: undefined,
      defaultPath: undefined,
      filters: undefined,
      properties: ["openFile"],
      title: undefined,
    });
  });

  it("maps the common options and multi-selection", async () => {
    await call(openFile, {
      buttonLabel: "Open",
      defaultPath: "/tmp",
      filters: [{ extensions: [".png"], name: "Images" }],
      multiple: true,
      showHiddenFiles: true,
      title: "Pick a file",
    });

    expect(state.showOpenDialog).toHaveBeenCalledWith(window, {
      buttonLabel: "Open",
      defaultPath: "/tmp",
      filters: [{ extensions: ["png"], name: "Images" }],
      properties: ["openFile", "multiSelections", "showHiddenFiles"],
      title: "Pick a file",
    });
  });

  it("returns a cancelled result without throwing", async () => {
    state.showOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: [],
    });

    await expect(call(openFile, {})).resolves.toEqual({
      canceled: true,
      filePaths: [],
    });
  });

  it("wraps a native dialog failure in INTERNAL_SERVER_ERROR", async () => {
    state.showOpenDialog.mockRejectedValue(new Error("native failure"));

    await expect(call(openFile, {})).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("fails when no main window is set", async () => {
    ipcContext.mainWindow = undefined;

    await expect(call(openFile, {})).rejects.toThrow(
      "Main window is not set in IPC context."
    );
  });
});

describe("openDirectory", () => {
  it("opens a directory dialog with multi-selection", async () => {
    await expect(
      call(openDirectory, { multiple: true, title: "Pick a folder" })
    ).resolves.toEqual({
      canceled: false,
      filePaths: ["/tmp/picked.txt"],
    });

    expect(state.showOpenDialog).toHaveBeenCalledWith(window, {
      buttonLabel: undefined,
      defaultPath: undefined,
      properties: ["openDirectory", "multiSelections"],
      title: "Pick a folder",
    });
  });
});
