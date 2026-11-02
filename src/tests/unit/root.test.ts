// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertConfiguredRoot,
  RootDirectoryError,
  type RootDirectoryErrorReason,
} from "@/fs/root";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fs-root-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { force: true, recursive: true });
});

async function captureError(
  action: () => Promise<unknown>
): Promise<RootDirectoryError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof RootDirectoryError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected the call to reject.");
}

describe("assertConfiguredRoot", () => {
  it("returns the resolved path for a real directory", async () => {
    const root = path.join(tempDir, "articles");

    await fs.mkdir(root);

    await expect(assertConfiguredRoot(root)).resolves.toBe(root);
  });

  it("resolves a relative path", async () => {
    await expect(assertConfiguredRoot(".")).resolves.toBe(process.cwd());
  });

  it("reports an unconfigured root", async () => {
    const error = await captureError(() => assertConfiguredRoot(null));

    expect(error.reason).toBe<RootDirectoryErrorReason>("NOT_CONFIGURED");
    expect(error.message).toBe("The articles directory is not configured.");
  });

  it("reports a missing root", async () => {
    const root = path.join(tempDir, "missing");
    const error = await captureError(() => assertConfiguredRoot(root));

    expect(error.reason).toBe<RootDirectoryErrorReason>("NOT_FOUND");
    expect(error.message).toBe(`Articles directory "${root}" does not exist.`);
  });

  it("reports a NUL-containing root as absent", async () => {
    const error = await captureError(() =>
      assertConfiguredRoot(`${tempDir}\0`)
    );

    expect(error.reason).toBe<RootDirectoryErrorReason>("NOT_FOUND");
  });

  it.skipIf(process.platform === "win32")(
    "refuses a symbolic link",
    async () => {
      const target = path.join(tempDir, "real-root");
      const link = path.join(tempDir, "root-link");

      await fs.mkdir(target);
      await fs.symlink(target, link, "dir");

      const error = await captureError(() => assertConfiguredRoot(link));

      expect(error.reason).toBe<RootDirectoryErrorReason>("SYMLINK");
      expect(error.message).toBe(
        `Refusing to use articles directory "${link}": it is a symbolic link.`
      );
    }
  );

  it("refuses a regular file", async () => {
    const file = path.join(tempDir, "root-file");

    await fs.writeFile(file, "not a directory");

    const error = await captureError(() => assertConfiguredRoot(file));

    expect(error.reason).toBe<RootDirectoryErrorReason>("NOT_DIRECTORY");
    expect(error.message).toBe(
      `Articles directory "${file}" is not a directory.`
    );
  });
});
