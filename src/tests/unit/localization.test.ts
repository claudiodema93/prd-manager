import { describe, expect, it } from "vitest";
import "@/localization/i18n";
import i18n from "i18next";
import langs, { LANGUAGE_KEYS, type LanguageKey } from "@/localization/langs";

function translationKeys(language: LanguageKey): string[] {
  const bundle = i18n.getResourceBundle(language, "translation") as
    | Record<string, string>
    | undefined;

  if (!bundle) {
    throw new Error(`Missing translation bundle for "${language}"`);
  }

  return Object.keys(bundle).sort();
}

describe("language configuration", () => {
  it("keeps LANGUAGE_KEYS and the language list in sync", () => {
    expect(langs.map((lang) => lang.key)).toEqual([...LANGUAGE_KEYS]);
  });
});

describe("translation resources", () => {
  it("defines the same keys in every locale", () => {
    const reference = translationKeys("en");

    expect(reference.length).toBeGreaterThan(0);

    for (const language of LANGUAGE_KEYS) {
      expect(translationKeys(language)).toEqual(reference);
    }
  });

  it("covers the keys the application shell renders", () => {
    const required = [
      "appName",
      "documentation",
      "madeBy",
      "navigation",
      "titleHomePage",
      "titleSecondPage",
    ];

    for (const language of LANGUAGE_KEYS) {
      const bundle = i18n.getResourceBundle(language, "translation") as Record<
        string,
        string
      >;

      for (const key of required) {
        expect(bundle[key]).toBeTruthy();
      }
    }
  });
});
