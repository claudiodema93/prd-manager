import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFolderPreferences, setFolderPreference } from "@/actions/folders";

const { getFolders, setFolder } = vi.hoisted(() => ({
  getFolders: vi.fn(),
  setFolder: vi.fn(),
}));

vi.mock("@/ipc/manager", () => ({
  ipc: {
    client: {
      preferences: {
        getFolders,
        setFolder,
      },
    },
  },
}));

const EMPTY_FOLDERS = {
  articlesDirectory: null,
  issuesDirectory: null,
  trashDirectory: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("folder actions", () => {
  it("returns the stored folders", async () => {
    getFolders.mockResolvedValue(EMPTY_FOLDERS);

    await expect(getFolderPreferences()).resolves.toEqual(EMPTY_FOLDERS);
    expect(getFolders).toHaveBeenCalledWith();
  });

  it("forwards the key and directory and returns the updated folders", async () => {
    const updated = { ...EMPTY_FOLDERS, articlesDirectory: "/tmp/articles" };
    setFolder.mockResolvedValue(updated);

    await expect(
      setFolderPreference("articlesDirectory", "/tmp/articles")
    ).resolves.toEqual(updated);
    expect(setFolder).toHaveBeenCalledWith({
      directory: "/tmp/articles",
      key: "articlesDirectory",
    });
  });

  it("forwards a null directory to clear a folder", async () => {
    setFolder.mockResolvedValue(EMPTY_FOLDERS);

    await expect(setFolderPreference("trashDirectory", null)).resolves.toEqual(
      EMPTY_FOLDERS
    );
    expect(setFolder).toHaveBeenCalledWith({
      directory: null,
      key: "trashDirectory",
    });
  });
});
