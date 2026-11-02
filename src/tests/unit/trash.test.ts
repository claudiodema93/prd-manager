// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureTrashSubdirectory,
  moveFolderToTrash,
  TrashMoveError,
  type TrashMoveErrorReason,
} from "@/fs/trash";

/**
 * `rename`/`rm`/`cp` failures are injected per call so the Windows replace
 * fallback and the cross-device trash fallback can be exercised
 * deterministically on every platform. Everything else delegates to the real
 * implementation.
 */
const fsControl = vi.hoisted(() => ({
  failCp: false,
  failRenameAt: new Map<number, string>(),
  failRmAt: new Map<number, string>(),
  renameCalls: 0,
  rmCalls: 0,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();

  const errno = (operation: string, code: string): NodeJS.ErrnoException =>
    Object.assign(new Error(`mock ${operation} failure (${code})`), { code });

  return {
    ...actual,
    cp: async (...args: Parameters<typeof actual.cp>) => {
      if (fsControl.failCp) {
        throw errno("cp", "EIO");
      }

      await actual.cp(...args);
    },
    rename: async (from: string, to: string) => {
      fsControl.renameCalls += 1;

      const code = fsControl.failRenameAt.get(fsControl.renameCalls);

      if (code === undefined) {
        await actual.rename(from, to);

        return;
      }

      fsControl.failRenameAt.delete(fsControl.renameCalls);
      throw errno("rename", code);
    },
    rm: async (target: string, options?: Parameters<typeof actual.rm>[1]) => {
      fsControl.rmCalls += 1;

      const code = fsControl.failRmAt.get(fsControl.rmCalls);

      if (code === undefined) {
        await actual.rm(target, options);

        return;
      }

      fsControl.failRmAt.delete(fsControl.rmCalls);
      throw errno("rm", code);
    },
  };
});

/**
 * `randomUUID` is pinned only for the collision-exhaustion cases; every other
 * call delegates to the real implementation.
 */
const cryptoControl = vi.hoisted(() => ({ uuid: null as string | null }));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();

  return {
    ...actual,
    randomUUID: () =>
      cryptoControl.uuid === null ? actual.randomUUID() : cryptoControl.uuid,
  };
});

const FOLDER_NAME = "customer-0001";
const TRASH_SUFFIX_PATTERN = /-\d+(?:-\d+)?$/u;
const RANDOM_SUFFIX_PATTERN =
  /^customer-0001-1700000000000-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const FIXED_NOW = 1_700_000_000_000;
const RANDOM_UUID = "00000000-0000-4000-8000-000000000000";

let tempDir: string;

beforeEach(async () => {
  cryptoControl.uuid = null;
  fsControl.failCp = false;
  fsControl.renameCalls = 0;
  fsControl.rmCalls = 0;
  fsControl.failRenameAt.clear();
  fsControl.failRmAt.clear();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fs-trash-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { force: true, recursive: true });
});

async function captureError(
  action: () => Promise<unknown>
): Promise<TrashMoveError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof TrashMoveError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected the call to reject.");
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);

    return true;
  } catch {
    return false;
  }
}

describe("ensureTrashSubdirectory", () => {
  it("creates and returns nested subdirectories", async () => {
    const trash = path.join(tempDir, "trash");

    await fs.mkdir(trash);

    const target = await ensureTrashSubdirectory(
      trash,
      "articles",
      FOLDER_NAME
    );

    expect(target).toBe(path.join(trash, "articles", FOLDER_NAME));
    expect((await fs.lstat(target)).isDirectory()).toBe(true);
  });

  it("reuses an existing subdirectory", async () => {
    const trash = path.join(tempDir, "trash");
    const existing = path.join(trash, "customers");

    await fs.mkdir(existing, { recursive: true });

    await expect(ensureTrashSubdirectory(trash, "customers")).resolves.toBe(
      existing
    );
  });

  it("returns the trash root when no segment is requested", async () => {
    const trash = path.join(tempDir, "trash");

    await fs.mkdir(trash);

    await expect(ensureTrashSubdirectory(trash)).resolves.toBe(trash);
  });

  it("fails with TRASH_NOT_FOUND when the trash root is missing", async () => {
    const error = await captureError(() =>
      ensureTrashSubdirectory(path.join(tempDir, "missing"), "customers")
    );

    expect(error.reason).toBe<TrashMoveErrorReason>("TRASH_NOT_FOUND");
  });

  it("fails with TRASH_NOT_DIRECTORY when the trash root is a file", async () => {
    const file = path.join(tempDir, "trash-file");

    await fs.writeFile(file, "not a directory");

    const error = await captureError(() =>
      ensureTrashSubdirectory(file, "customers")
    );

    expect(error.reason).toBe<TrashMoveErrorReason>("TRASH_NOT_DIRECTORY");
  });

  it.skipIf(process.platform === "win32")(
    "fails with TRASH_SYMLINK when the trash root is a symlink",
    async () => {
      const realTrash = path.join(tempDir, "real-trash");
      const link = path.join(tempDir, "trash-link");

      await fs.mkdir(realTrash);
      await fs.symlink(realTrash, link, "dir");

      const error = await captureError(() =>
        ensureTrashSubdirectory(link, "customers")
      );

      expect(error.reason).toBe<TrashMoveErrorReason>("TRASH_SYMLINK");
    }
  );

  it.skipIf(process.platform === "win32")(
    "refuses a symlinked subdirectory",
    async () => {
      const trash = path.join(tempDir, "trash");
      const outside = path.join(tempDir, "outside");
      const link = path.join(trash, "customers");

      await fs.mkdir(trash);
      await fs.mkdir(outside);
      await fs.symlink(outside, link, "dir");

      const error = await captureError(() =>
        ensureTrashSubdirectory(trash, "customers")
      );

      expect(error.reason).toBe<TrashMoveErrorReason>("TRASH_SYMLINK");
    }
  );

  it("refuses a regular file used as a subdirectory", async () => {
    const trash = path.join(tempDir, "trash");
    const file = path.join(trash, "customers");

    await fs.mkdir(trash);
    await fs.writeFile(file, "not a directory");

    const error = await captureError(() =>
      ensureTrashSubdirectory(trash, "customers")
    );

    expect(error.reason).toBe<TrashMoveErrorReason>("TRASH_NOT_DIRECTORY");
  });

  it("rejects invalid subdirectory names", async () => {
    const trash = path.join(tempDir, "trash");

    await fs.mkdir(trash);

    const errors = await Promise.all(
      [".", "..", "", "a/b", "a\\b", "../x", "a\0b"].map((segment) =>
        captureError(() => ensureTrashSubdirectory(trash, segment))
      )
    );

    for (const error of errors) {
      expect(error.reason).toBe<TrashMoveErrorReason>("INVALID_SEGMENT");
    }
  });

  it("rejects a relative trash path", async () => {
    const error = await captureError(() =>
      ensureTrashSubdirectory("relative-trash", "customers")
    );

    expect(error.reason).toBe<TrashMoveErrorReason>("INVALID_PATH");
  });
});

describe("moveFolderToTrash", () => {
  it("moves a folder into the trash", async () => {
    const trash = path.join(tempDir, "trash");
    const source = path.join(tempDir, FOLDER_NAME);

    await fs.mkdir(trash);
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, "note.txt"), "hello");

    const destination = await moveFolderToTrash({
      folderName: FOLDER_NAME,
      sourceFolderPath: source,
      trashDirectory: trash,
    });

    expect(destination).toBe(path.join(trash, FOLDER_NAME));
    await expect(pathExists(source)).resolves.toBe(false);
    await expect(
      fs.readFile(path.join(destination, "note.txt"), "utf8")
    ).resolves.toBe("hello");
  });

  it("adds a suffix when the destination already exists", async () => {
    const trash = path.join(tempDir, "trash");
    const source = path.join(tempDir, FOLDER_NAME);
    const original = path.join(trash, FOLDER_NAME);

    await fs.mkdir(original, { recursive: true });
    await fs.mkdir(source);

    const destination = await moveFolderToTrash({
      folderName: FOLDER_NAME,
      sourceFolderPath: source,
      trashDirectory: trash,
    });

    expect(destination).not.toBe(original);
    expect(destination.startsWith(`${original}-`)).toBe(true);
    expect(path.basename(destination)).toMatch(TRASH_SUFFIX_PATTERN);
    await expect(pathExists(destination)).resolves.toBe(true);
  });

  it("adds a numeric suffix when the timestamped destination is taken", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    try {
      const trash = path.join(tempDir, "trash");
      const source = path.join(tempDir, FOLDER_NAME);
      const original = path.join(trash, FOLDER_NAME);
      const stamped = `${original}-1700000000000`;

      await fs.mkdir(original, { recursive: true });
      await fs.mkdir(stamped);
      await fs.mkdir(source);

      const destination = await moveFolderToTrash({
        folderName: FOLDER_NAME,
        sourceFolderPath: source,
        trashDirectory: trash,
      });

      expect(destination).toBe(`${stamped}-1`);
      await expect(pathExists(destination)).resolves.toBe(true);
    } finally {
      now.mockRestore();
    }
  });

  it("copies then removes the source when the move crosses devices", async () => {
    const trash = path.join(tempDir, "trash");
    const source = path.join(tempDir, FOLDER_NAME);

    await fs.mkdir(trash);
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, "note.txt"), "hello");
    fsControl.failRenameAt.set(1, "EXDEV");

    const destination = await moveFolderToTrash({
      folderName: FOLDER_NAME,
      sourceFolderPath: source,
      trashDirectory: trash,
    });

    expect(destination).toBe(path.join(trash, FOLDER_NAME));
    await expect(pathExists(source)).resolves.toBe(false);
    await expect(
      fs.readFile(path.join(destination, "note.txt"), "utf8")
    ).resolves.toBe("hello");
  });

  it("falls back to a random suffix after 1,000 collisions", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW);

    try {
      const trash = path.join(tempDir, "trash");
      const source = path.join(tempDir, FOLDER_NAME);
      const base = path.join(trash, FOLDER_NAME);
      const stamped = `${base}-${FIXED_NOW}`;

      await fs.mkdir(trash);
      await fs.mkdir(source);
      await fs.mkdir(base);

      for (let counter = 0; counter <= 1000; counter += 1) {
        // biome-ignore lint/performance/noAwaitInLoops: the collision set must exist before the move.
        await fs.mkdir(counter === 0 ? stamped : `${stamped}-${counter}`);
      }

      const destination = await moveFolderToTrash({
        folderName: FOLDER_NAME,
        sourceFolderPath: source,
        trashDirectory: trash,
      });

      expect(destination.startsWith(`${stamped}-`)).toBe(true);
      expect(path.basename(destination)).toMatch(RANDOM_SUFFIX_PATTERN);
      await expect(pathExists(destination)).resolves.toBe(true);
      await expect(pathExists(source)).resolves.toBe(false);
    } finally {
      now.mockRestore();
    }
  }, 30_000);

  it("fails when even the random destination exists", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
    cryptoControl.uuid = RANDOM_UUID;

    try {
      const trash = path.join(tempDir, "trash");
      const source = path.join(tempDir, FOLDER_NAME);
      const base = path.join(trash, FOLDER_NAME);
      const stamped = `${base}-${FIXED_NOW}`;

      await fs.mkdir(trash);
      await fs.mkdir(source);
      await fs.mkdir(base);

      for (let counter = 0; counter <= 1000; counter += 1) {
        // biome-ignore lint/performance/noAwaitInLoops: the collision set must exist before the move.
        await fs.mkdir(counter === 0 ? stamped : `${stamped}-${counter}`);
      }

      await fs.mkdir(`${stamped}-${RANDOM_UUID}`);

      const error = await captureError(() =>
        moveFolderToTrash({
          folderName: FOLDER_NAME,
          sourceFolderPath: source,
          trashDirectory: trash,
        })
      );

      // An exhausted destination probe keeps its MOVE_FAILED reason, which the
      // services map to TRASH_MOVE_FAILED (a 5xx).
      expect(error.reason).toBe<TrashMoveErrorReason>("MOVE_FAILED");
      await expect(pathExists(source)).resolves.toBe(true);
    } finally {
      now.mockRestore();
      cryptoControl.uuid = null;
    }
  }, 30_000);

  it("reports COPY_FAILED and keeps the source when the copy fails", async () => {
    const trash = path.join(tempDir, "trash");
    const source = path.join(tempDir, FOLDER_NAME);

    await fs.mkdir(trash);
    await fs.mkdir(source);
    fsControl.failRenameAt.set(1, "EXDEV");
    fsControl.failCp = true;

    const error = await captureError(() =>
      moveFolderToTrash({
        folderName: FOLDER_NAME,
        sourceFolderPath: source,
        trashDirectory: trash,
      })
    );

    expect(error.reason).toBe<TrashMoveErrorReason>("COPY_FAILED");
    await expect(pathExists(source)).resolves.toBe(true);
    await expect(pathExists(path.join(trash, FOLDER_NAME))).resolves.toBe(
      false
    );
  });

  it("keeps both copies when the source removal fails", async () => {
    const trash = path.join(tempDir, "trash");
    const source = path.join(tempDir, FOLDER_NAME);

    await fs.mkdir(trash);
    await fs.mkdir(source);
    fsControl.failRenameAt.set(1, "EXDEV");
    fsControl.failRmAt.set(1, "EACCES");

    const error = await captureError(() =>
      moveFolderToTrash({
        folderName: FOLDER_NAME,
        sourceFolderPath: source,
        trashDirectory: trash,
      })
    );

    expect(error.reason).toBe<TrashMoveErrorReason>("SOURCE_REMOVE_FAILED");
    await expect(pathExists(source)).resolves.toBe(true);
    await expect(pathExists(path.join(trash, FOLDER_NAME))).resolves.toBe(true);
  });

  it("reports MOVE_FAILED for a non-EXDEV rename error", async () => {
    const trash = path.join(tempDir, "trash");
    const source = path.join(tempDir, FOLDER_NAME);

    await fs.mkdir(trash);
    await fs.mkdir(source);
    fsControl.failRenameAt.set(1, "EACCES");

    const error = await captureError(() =>
      moveFolderToTrash({
        folderName: FOLDER_NAME,
        sourceFolderPath: source,
        trashDirectory: trash,
      })
    );

    expect(error.reason).toBe<TrashMoveErrorReason>("MOVE_FAILED");
    await expect(pathExists(source)).resolves.toBe(true);
  });

  it("fails with SOURCE_NOT_FOUND when the source is missing", async () => {
    const trash = path.join(tempDir, "trash");

    await fs.mkdir(trash);

    const error = await captureError(() =>
      moveFolderToTrash({
        folderName: FOLDER_NAME,
        sourceFolderPath: path.join(tempDir, "missing-source"),
        trashDirectory: trash,
      })
    );

    expect(error.reason).toBe<TrashMoveErrorReason>("SOURCE_NOT_FOUND");
  });

  it.skipIf(process.platform === "win32")(
    "fails with SOURCE_SYMLINK when the source is a symlink",
    async () => {
      const trash = path.join(tempDir, "trash");
      const realFolder = path.join(tempDir, "real-source");
      const link = path.join(tempDir, FOLDER_NAME);

      await fs.mkdir(trash);
      await fs.mkdir(realFolder);
      await fs.symlink(realFolder, link, "dir");

      const error = await captureError(() =>
        moveFolderToTrash({
          folderName: FOLDER_NAME,
          sourceFolderPath: link,
          trashDirectory: trash,
        })
      );

      expect(error.reason).toBe<TrashMoveErrorReason>("SOURCE_SYMLINK");
    }
  );

  it("fails with SOURCE_NOT_DIRECTORY when the source is a file", async () => {
    const trash = path.join(tempDir, "trash");
    const source = path.join(tempDir, FOLDER_NAME);

    await fs.mkdir(trash);
    await fs.writeFile(source, "not a folder");

    const error = await captureError(() =>
      moveFolderToTrash({
        folderName: FOLDER_NAME,
        sourceFolderPath: source,
        trashDirectory: trash,
      })
    );

    expect(error.reason).toBe<TrashMoveErrorReason>("SOURCE_NOT_DIRECTORY");
  });

  it("rejects invalid folder names", async () => {
    const trash = path.join(tempDir, "trash");
    const source = path.join(tempDir, FOLDER_NAME);

    await fs.mkdir(trash);
    await fs.mkdir(source);

    const errors = await Promise.all(
      [".", "..", "../x", "a/b", "a\\b", "", "a\0b"].map((folderName) =>
        captureError(() =>
          moveFolderToTrash({
            folderName,
            sourceFolderPath: source,
            trashDirectory: trash,
          })
        )
      )
    );

    for (const error of errors) {
      expect(error.reason).toBe<TrashMoveErrorReason>("INVALID_FOLDER_NAME");
    }
  });

  it("rejects a source whose name does not match the folder name", async () => {
    const trash = path.join(tempDir, "trash");
    const source = path.join(tempDir, "other-folder");

    await fs.mkdir(trash);
    await fs.mkdir(source);

    const error = await captureError(() =>
      moveFolderToTrash({
        folderName: FOLDER_NAME,
        sourceFolderPath: source,
        trashDirectory: trash,
      })
    );

    expect(error.reason).toBe<TrashMoveErrorReason>("SOURCE_NAME_MISMATCH");
  });

  it("fails with TRASH_NOT_FOUND when the trash root is missing", async () => {
    const source = path.join(tempDir, FOLDER_NAME);

    await fs.mkdir(source);

    const error = await captureError(() =>
      moveFolderToTrash({
        folderName: FOLDER_NAME,
        sourceFolderPath: source,
        trashDirectory: path.join(tempDir, "missing-trash"),
      })
    );

    expect(error.reason).toBe<TrashMoveErrorReason>("TRASH_NOT_FOUND");
  });

  it("fails with TRASH_NOT_DIRECTORY when the trash root is a file", async () => {
    const trash = path.join(tempDir, "trash-file");
    const source = path.join(tempDir, FOLDER_NAME);

    await fs.writeFile(trash, "not a directory");
    await fs.mkdir(source);

    const error = await captureError(() =>
      moveFolderToTrash({
        folderName: FOLDER_NAME,
        sourceFolderPath: source,
        trashDirectory: trash,
      })
    );

    expect(error.reason).toBe<TrashMoveErrorReason>("TRASH_NOT_DIRECTORY");
  });

  it.skipIf(process.platform === "win32")(
    "fails with TRASH_SYMLINK when the trash root is a symlink",
    async () => {
      const realTrash = path.join(tempDir, "real-trash");
      const link = path.join(tempDir, "trash-link");
      const source = path.join(tempDir, FOLDER_NAME);

      await fs.mkdir(realTrash);
      await fs.symlink(realTrash, link, "dir");
      await fs.mkdir(source);

      const error = await captureError(() =>
        moveFolderToTrash({
          folderName: FOLDER_NAME,
          sourceFolderPath: source,
          trashDirectory: link,
        })
      );

      expect(error.reason).toBe<TrashMoveErrorReason>("TRASH_SYMLINK");
    }
  );

  it("refuses a trash directory inside the source", async () => {
    const source = path.join(tempDir, FOLDER_NAME);
    const nestedTrash = path.join(source, "trash");

    await fs.mkdir(nestedTrash, { recursive: true });

    const error = await captureError(() =>
      moveFolderToTrash({
        folderName: FOLDER_NAME,
        sourceFolderPath: source,
        trashDirectory: nestedTrash,
      })
    );

    expect(error.reason).toBe<TrashMoveErrorReason>("TRASH_INSIDE_SOURCE");
  });

  it("rejects a relative source path", async () => {
    const trash = path.join(tempDir, "trash");

    await fs.mkdir(trash);

    const error = await captureError(() =>
      moveFolderToTrash({
        folderName: FOLDER_NAME,
        sourceFolderPath: "relative-source",
        trashDirectory: trash,
      })
    );

    expect(error.reason).toBe<TrashMoveErrorReason>("INVALID_PATH");
  });

  it("rejects a source path containing NUL", async () => {
    const trash = path.join(tempDir, "trash");

    await fs.mkdir(trash);

    const error = await captureError(() =>
      moveFolderToTrash({
        folderName: FOLDER_NAME,
        sourceFolderPath: `${path.join(tempDir, FOLDER_NAME)}\0`,
        trashDirectory: trash,
      })
    );

    expect(error.reason).toBe<TrashMoveErrorReason>("INVALID_PATH");
  });
});
