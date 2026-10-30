import type { i18n as I18n } from "i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setAppLanguage, updateAppLanguage } from "@/actions/language";
import { LOCAL_STORAGE_KEYS } from "@/constants";

function createI18n(initialLanguage = "en") {
  let language = initialLanguage;

  const changeLanguage = vi.fn((next: string) => {
    language = next;
    return Promise.resolve();
  });

  return {
    changeLanguage,
    get language() {
      return language;
    },
  };
}

type FakeI18n = ReturnType<typeof createI18n>;

function asI18n(fake: FakeI18n): I18n {
  return fake as unknown as I18n;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "";
});

describe("setAppLanguage", () => {
  it("stores the language, changes i18n and updates document.lang", () => {
    const fake = createI18n("en");

    setAppLanguage("pt-BR", asI18n(fake));

    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.LANGUAGE)).toBe("pt-BR");
    expect(fake.changeLanguage).toHaveBeenCalledWith("pt-BR");
    expect(document.documentElement.lang).toBe("pt-BR");
  });

  it("ignores an empty value emitted by the toggle group", () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.LANGUAGE, "pt-BR");
    document.documentElement.lang = "pt-BR";
    const fake = createI18n("pt-BR");

    setAppLanguage("", asI18n(fake));

    expect(fake.changeLanguage).not.toHaveBeenCalled();
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.LANGUAGE)).toBe("pt-BR");
    expect(document.documentElement.lang).toBe("pt-BR");
  });
});

describe("updateAppLanguage", () => {
  it("restores a stored language into storage, i18n and document.lang", () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.LANGUAGE, "pt-BR");
    const fake = createI18n("en");

    updateAppLanguage(asI18n(fake));

    expect(fake.changeLanguage).toHaveBeenCalledWith("pt-BR");
    expect(fake.language).toBe("pt-BR");
    expect(document.documentElement.lang).toBe("pt-BR");
  });

  it("still exposes i18n.language when nothing is stored", () => {
    const fake = createI18n("en");

    updateAppLanguage(asI18n(fake));

    expect(fake.changeLanguage).not.toHaveBeenCalled();
    expect(document.documentElement.lang).toBe("en");
  });
});
