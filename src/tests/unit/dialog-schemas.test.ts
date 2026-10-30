import { describe, expect, it } from "vitest";
import {
  openDirectoryDialogInputSchema,
  openFileDialogInputSchema,
} from "@/ipc/dialog/schemas";

const imageFilter = {
  extensions: ["png"],
  name: "Images",
};

describe("openFileDialogInputSchema", () => {
  it("applies the boolean defaults", () => {
    expect(openFileDialogInputSchema.parse({})).toEqual({
      multiple: false,
      showHiddenFiles: false,
    });
  });

  it("accepts every cross-platform option", () => {
    expect(
      openFileDialogInputSchema.parse({
        buttonLabel: "Open",
        defaultPath: "/tmp",
        filters: [imageFilter],
        multiple: true,
        showHiddenFiles: true,
        title: "Pick a file",
      })
    ).toEqual({
      buttonLabel: "Open",
      defaultPath: "/tmp",
      filters: [imageFilter],
      multiple: true,
      showHiddenFiles: true,
      title: "Pick a file",
    });
  });

  it("normalises dotted and wildcard extensions", () => {
    const parsed = openFileDialogInputSchema.parse({
      filters: [
        {
          extensions: [".png", "*.jpg", "*", "*.*"],
          name: "Files",
        },
      ],
    });

    expect(parsed.filters).toEqual([
      { extensions: ["png", "jpg", "*", "*"], name: "Files" },
    ]);
  });

  it("accepts an empty filter list as no filter", () => {
    expect(openFileDialogInputSchema.parse({ filters: [] }).filters).toEqual(
      []
    );
  });

  it("rejects extensions that are not bare extensions", () => {
    for (const extension of ["*.tar.gz", "png/jpg", "a b", "."]) {
      expect(
        openFileDialogInputSchema.safeParse({
          filters: [{ extensions: [extension], name: "Files" }],
        }).success
      ).toBe(false);
    }
  });

  it("rejects an empty extension list", () => {
    expect(
      openFileDialogInputSchema.safeParse({
        filters: [{ extensions: [], name: "Files" }],
      }).success
    ).toBe(false);
  });

  it("rejects too many filters and extensions", () => {
    const tooManyFilters = Array.from({ length: 21 }, (_, index) => ({
      extensions: ["png"],
      name: `Filter ${index}`,
    }));
    const tooManyExtensions = Array.from({ length: 51 }, () => "png");

    expect(
      openFileDialogInputSchema.safeParse({ filters: tooManyFilters }).success
    ).toBe(false);
    expect(
      openFileDialogInputSchema.safeParse({
        filters: [{ extensions: tooManyExtensions, name: "Files" }],
      }).success
    ).toBe(false);
  });

  it("rejects unknown keys, including raw Electron properties", () => {
    expect(
      openFileDialogInputSchema.safeParse({ properties: ["openFile"] }).success
    ).toBe(false);
    expect(
      openFileDialogInputSchema.safeParse({ securityScopedBookmarks: true })
        .success
    ).toBe(false);
  });

  it("rejects a NUL character in text and paths", () => {
    expect(
      openFileDialogInputSchema.safeParse({ defaultPath: "/tmp/\u0000" })
        .success
    ).toBe(false);
    expect(
      openFileDialogInputSchema.safeParse({ title: "a\u0000b" }).success
    ).toBe(false);
    expect(
      openFileDialogInputSchema.safeParse({ buttonLabel: "a\u0000b" }).success
    ).toBe(false);
    expect(
      openFileDialogInputSchema.safeParse({
        filters: [{ extensions: ["png"], name: "a\u0000b" }],
      }).success
    ).toBe(false);
  });

  it("requires an absolute, non-UNC defaultPath", () => {
    expect(
      openFileDialogInputSchema.safeParse({ defaultPath: "relative/dir" })
        .success
    ).toBe(false);
    for (const uncPath of [
      "\\\\server\\share",
      "//server/share",
      "\\\\?\\C:\\dir",
      "//?/C:/dir",
      "\\\\.\\pipe\\name",
    ]) {
      expect(
        openFileDialogInputSchema.safeParse({ defaultPath: uncPath }).success
      ).toBe(false);
    }
    expect(
      openFileDialogInputSchema.safeParse({ defaultPath: "/tmp/dir" }).success
    ).toBe(true);
  });

  it("enforces text and filter limits at the boundary", () => {
    expect(
      openFileDialogInputSchema.safeParse({ title: "x".repeat(256) }).success
    ).toBe(true);
    expect(
      openFileDialogInputSchema.safeParse({ title: "x".repeat(257) }).success
    ).toBe(false);
    expect(
      openFileDialogInputSchema.safeParse({
        filters: [{ extensions: ["x".repeat(16)], name: "x".repeat(64) }],
      }).success
    ).toBe(true);
    expect(
      openFileDialogInputSchema.safeParse({
        filters: [{ extensions: ["x".repeat(17)], name: "Files" }],
      }).success
    ).toBe(false);
    expect(
      openFileDialogInputSchema.safeParse({
        filters: [{ extensions: ["png"], name: "x".repeat(65) }],
      }).success
    ).toBe(false);
  });

  it("accepts defaultPath at the maximum length", () => {
    const maximum = `/${"a".repeat(4095)}`;
    const tooLong = `/${"a".repeat(4096)}`;

    expect(
      openFileDialogInputSchema.safeParse({ defaultPath: maximum }).success
    ).toBe(true);
    expect(
      openFileDialogInputSchema.safeParse({ defaultPath: tooLong }).success
    ).toBe(false);
  });

  it("rejects whitespace-only text and extra filter keys", () => {
    expect(openFileDialogInputSchema.safeParse({ title: "   " }).success).toBe(
      false
    );
    expect(
      openFileDialogInputSchema.safeParse({
        filters: [{ extensions: ["png"], icon: "x", name: "Images" }],
      }).success
    ).toBe(false);
  });
});

describe("openDirectoryDialogInputSchema", () => {
  it("applies the boolean defaults", () => {
    expect(openDirectoryDialogInputSchema.parse({})).toEqual({
      multiple: false,
      showHiddenFiles: false,
    });
  });

  it("accepts the common options", () => {
    expect(
      openDirectoryDialogInputSchema.parse({
        buttonLabel: "Choose",
        defaultPath: "/tmp",
        multiple: true,
        showHiddenFiles: true,
        title: "Pick a folder",
      })
    ).toEqual({
      buttonLabel: "Choose",
      defaultPath: "/tmp",
      multiple: true,
      showHiddenFiles: true,
      title: "Pick a folder",
    });
  });

  it("does not accept file filters", () => {
    expect(
      openDirectoryDialogInputSchema.safeParse({ filters: [imageFilter] })
        .success
    ).toBe(false);
  });
});
