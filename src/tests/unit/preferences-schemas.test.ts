import { describe, expect, it } from "vitest";
import {
  getPreferencesOutputSchema,
  setLanguageInputSchema,
} from "@/ipc/preferences/schemas";

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

  it("validates the preferences output shape", () => {
    expect(
      getPreferencesOutputSchema.safeParse({
        language: "pt-BR",
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
