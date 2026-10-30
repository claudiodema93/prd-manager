import { describe, expect, it } from "vitest";
import {
  getPreferencesOutputSchema,
  setLanguageInputSchema,
  setSidebarOpenInputSchema,
} from "@/ipc/preferences/schemas";
import {
  appPreferencesSchema,
  DEFAULT_APP_PREFERENCES,
} from "@/preferences/schema";

describe("preferences schemas", () => {
  it("accepts every supported language", () => {
    expect(setLanguageInputSchema.safeParse({ language: "en" }).success).toBe(
      true
    );
    expect(
      setLanguageInputSchema.safeParse({ language: "pt-BR" }).success
    ).toBe(true);
  });

  it("rejects an unsupported language", () => {
    expect(setLanguageInputSchema.safeParse({ language: "fr" }).success).toBe(
      false
    );
  });

  it("rejects unknown keys", () => {
    expect(
      setLanguageInputSchema.safeParse({ extra: true, language: "en" }).success
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

  it("validates the sidebar state input", () => {
    expect(setSidebarOpenInputSchema.safeParse({ open: true }).success).toBe(
      true
    );
    expect(setSidebarOpenInputSchema.safeParse({ open: false }).success).toBe(
      true
    );
    expect(setSidebarOpenInputSchema.safeParse({ open: "yes" }).success).toBe(
      false
    );
    expect(
      setSidebarOpenInputSchema.safeParse({ extra: 1, open: true }).success
    ).toBe(false);
    expect(setSidebarOpenInputSchema.safeParse({}).success).toBe(false);
  });

  it("validates the preferences output shape", () => {
    expect(
      getPreferencesOutputSchema.safeParse({
        language: "pt-BR",
        sidebarOpen: true,
        theme: "dark",
      }).success
    ).toBe(true);
    expect(
      getPreferencesOutputSchema.safeParse({
        language: "en",
        sidebarOpen: true,
        theme: "purple",
      }).success
    ).toBe(false);
  });
});
