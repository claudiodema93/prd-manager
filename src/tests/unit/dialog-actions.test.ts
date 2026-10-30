import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDirectoryDialog, openFileDialog } from "@/actions/dialog";

const { openDirectory, openFile } = vi.hoisted(() => ({
  openDirectory: vi.fn(),
  openFile: vi.fn(),
}));

vi.mock("@/ipc/manager", () => ({
  ipc: {
    client: {
      dialog: {
        openDirectory,
        openFile,
      },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dialog actions", () => {
  it("forwards the default file options", async () => {
    openFile.mockResolvedValue({ canceled: true, filePaths: [] });

    await expect(openFileDialog()).resolves.toEqual({
      canceled: true,
      filePaths: [],
    });
    expect(openFile).toHaveBeenCalledWith({});
  });

  it("forwards file options and the result", async () => {
    openFile.mockResolvedValue({
      canceled: false,
      filePaths: ["/tmp/picked.png"],
    });
    const input = {
      filters: [{ extensions: ["png"], name: "Images" }],
      multiple: true,
    };

    await expect(openFileDialog(input)).resolves.toEqual({
      canceled: false,
      filePaths: ["/tmp/picked.png"],
    });
    expect(openFile).toHaveBeenCalledWith(input);
  });

  it("forwards directory options", async () => {
    openDirectory.mockResolvedValue({ canceled: true, filePaths: [] });

    await expect(
      openDirectoryDialog({ title: "Pick a folder" })
    ).resolves.toEqual({
      canceled: true,
      filePaths: [],
    });
    expect(openDirectory).toHaveBeenCalledWith({ title: "Pick a folder" });
  });
});
