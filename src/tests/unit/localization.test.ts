import { describe, expect, it } from "vitest";
import langs, { LANGUAGE_KEYS } from "@/localization/langs";

describe("language configuration", () => {
  it("keeps LANGUAGE_KEYS and the language list in sync", () => {
    expect(langs.map((lang) => lang.key)).toEqual([...LANGUAGE_KEYS]);
  });
});
