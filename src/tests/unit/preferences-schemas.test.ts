import { describe, expect, it } from "vitest";
import {
  folderKeySchema,
  foldersOutputSchema,
  getPreferencesOutputSchema,
  setFolderInputSchema,
  setLanguageInputSchema,
} from "@/ipc/preferences/schemas";
import {
  appPreferencesSchema,
  DEFAULT_APP_PREFERENCES,
  DEFAULT_WINDOW_STATE,
  directoryPreferenceSchema,
  folderPreferencesSchema,
  MAX_DIRECTORY_PATH_LENGTH,
} from "@/preferences/schema";
import { DEFAULT_FOLDER_PREFERENCES } from "@/types/preferences";

describe("preferences schemas", () => {
  it("accepts every supported language", () => {
    expect(setLanguageInputSchema.safeParse({ language: "it" }).success).toBe(
      true
    );
  });

  it("rejects unsupported languages", () => {
    expect(setLanguageInputSchema.safeParse({ language: "en" }).success).toBe(
      false
    );
    expect(
      setLanguageInputSchema.safeParse({ language: "pt-BR" }).success
    ).toBe(false);
    expect(setLanguageInputSchema.safeParse({ language: "fr" }).success).toBe(
      false
    );
  });

  it("rejects unknown keys", () => {
    expect(
      setLanguageInputSchema.safeParse({ extra: true, language: "it" }).success
    ).toBe(false);
  });

  it("strips unknown keys instead of discarding known preferences", () => {
    expect(
      appPreferencesSchema.parse({
        ...DEFAULT_APP_PREFERENCES,
        extra: true,
      })
    ).toEqual(DEFAULT_APP_PREFERENCES);
  });

  it("normalizes languages written by older releases", () => {
    for (const legacyLanguage of ["en", "pt-BR"]) {
      const parsed = appPreferencesSchema.parse({
        ...DEFAULT_APP_PREFERENCES,
        language: legacyLanguage,
        theme: "dark",
        window: { height: 700, isMaximized: true, width: 900 },
      });

      expect(parsed.language).toBe("it");
      expect(parsed.theme).toBe("dark");
      expect(parsed.window).toEqual({
        height: 700,
        isMaximized: true,
        width: 900,
      });
    }
  });

  it("keeps unrelated preferences when folders are malformed", () => {
    const parsed = appPreferencesSchema.parse({
      ...DEFAULT_APP_PREFERENCES,
      folders: {
        articlesDirectory: "relative/articles",
        issuesDirectory: null,
        trashDirectory: null,
      },
      theme: "dark",
    });

    expect(parsed.folders).toEqual(DEFAULT_FOLDER_PREFERENCES);
    expect(parsed.theme).toBe("dark");
  });

  it("validates the preferences output shape", () => {
    expect(
      getPreferencesOutputSchema.safeParse({
        language: "it",
        theme: "dark",
      }).success
    ).toBe(true);
    expect(
      getPreferencesOutputSchema.safeParse({
        language: "en",
        theme: "purple",
      }).success
    ).toBe(false);
  });
});

describe("folder preference schemas", () => {
  it("fills the folder defaults for a legacy preferences file", () => {
    const parsed = appPreferencesSchema.parse({
      language: "it",
      theme: "system",
      window: DEFAULT_WINDOW_STATE,
    });

    expect(parsed.folders).toEqual(DEFAULT_FOLDER_PREFERENCES);
  });

  it("accepts absolute and null directory values", () => {
    expect(directoryPreferenceSchema.safeParse("/tmp/articles").success).toBe(
      true
    );
    expect(directoryPreferenceSchema.safeParse(null).success).toBe(true);
  });

  it("rejects relative, UNC, NUL and empty directory values", () => {
    expect(
      directoryPreferenceSchema.safeParse("relative/articles").success
    ).toBe(false);
    for (const uncPath of [
      "\\\\server\\share",
      "//server/share",
      "\\\\?\\C:\\dir",
      "//?/C:/dir",
      "\\\\.\\pipe\\name",
    ]) {
      expect(directoryPreferenceSchema.safeParse(uncPath).success).toBe(false);
    }
    expect(
      directoryPreferenceSchema.safeParse("/tmp/artic\u0000les").success
    ).toBe(false);
    expect(directoryPreferenceSchema.safeParse("").success).toBe(false);
  });

  it("enforces the directory length boundary", () => {
    const maximum = `/${"a".repeat(MAX_DIRECTORY_PATH_LENGTH - 1)}`;
    const tooLong = `/${"a".repeat(MAX_DIRECTORY_PATH_LENGTH)}`;

    expect(directoryPreferenceSchema.safeParse(maximum).success).toBe(true);
    expect(directoryPreferenceSchema.safeParse(tooLong).success).toBe(false);
  });

  it("validates a complete folder set", () => {
    expect(
      folderPreferencesSchema.safeParse({
        articlesDirectory: "/tmp/articles",
        issuesDirectory: null,
        trashDirectory: "/tmp/trash",
      }).success
    ).toBe(true);
    expect(
      folderPreferencesSchema.safeParse({
        articlesDirectory: "relative",
        issuesDirectory: null,
        trashDirectory: null,
      }).success
    ).toBe(false);
  });

  it("only accepts the known folder keys", () => {
    expect(folderKeySchema.safeParse("articlesDirectory").success).toBe(true);
    expect(folderKeySchema.safeParse("downloadsDirectory").success).toBe(false);
  });

  it("validates setFolder input strictly", () => {
    expect(
      setFolderInputSchema.safeParse({
        directory: "/tmp/articles",
        key: "articlesDirectory",
      }).success
    ).toBe(true);
    expect(
      setFolderInputSchema.safeParse({
        directory: "/tmp/articles",
        extra: true,
        key: "articlesDirectory",
      }).success
    ).toBe(false);
    expect(
      setFolderInputSchema.safeParse({
        directory: "relative/articles",
        key: "articlesDirectory",
      }).success
    ).toBe(false);
  });

  it("rejects unknown keys in the folders output", () => {
    expect(
      foldersOutputSchema.safeParse({
        articlesDirectory: null,
        extra: true,
        issuesDirectory: null,
        trashDirectory: null,
      }).success
    ).toBe(false);
  });
});
