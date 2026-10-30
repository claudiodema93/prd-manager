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
          extensions: [".png", "*.jpg", "*"],
          name: "Files",
        },
      ],
    });

    expect(parsed.filters).toEqual([
      { extensions: ["png", "jpg", "*"], name: "Files" },
    ]);
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

  it("rejects a NUL character in defaultPath", () => {
    expect(
      openFileDialogInputSchema.safeParse({ defaultPath: "/tmp/\u0000" })
        .success
    ).toBe(false);
  });

  it("rejects text longer than the limit", () => {
    expect(
      openFileDialogInputSchema.safeParse({ title: "x".repeat(257) }).success
    ).toBe(false);
  });
});

describe("openDirectoryDialogInputSchema", () => {
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
