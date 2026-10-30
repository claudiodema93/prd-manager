import type { i18n as I18n } from "i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setAppLanguage, updateAppLanguage } from "@/actions/language";

const { getPreferences, setLanguage } = vi.hoisted(() => ({
  getPreferences: vi.fn(),
  setLanguage: vi.fn(),
}));

// Importing the real manager opens a MessageChannel; jsdom has no bridge.
vi.mock("@/ipc/manager", () => ({
  ipc: {
    client: {
      preferences: {
        getPreferences,
        setLanguage,
      },
    },
  },
}));

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
  vi.clearAllMocks();
  document.documentElement.lang = "";
  getPreferences.mockResolvedValue({ language: "en", theme: "system" });
  setLanguage.mockImplementation(({ language }: { language: string }) =>
    Promise.resolve({ language, theme: "system" })
  );
});

describe("setAppLanguage", () => {
  it("persists the language, changes i18n and updates document.lang", async () => {
    const fake = createI18n("en");

    await setAppLanguage("pt-BR", asI18n(fake));

    expect(setLanguage).toHaveBeenCalledWith({ language: "pt-BR" });
    expect(fake.changeLanguage).toHaveBeenCalledWith("pt-BR");
    expect(document.documentElement.lang).toBe("pt-BR");
  });

  it("ignores an empty value emitted by the toggle group", async () => {
    document.documentElement.lang = "pt-BR";
    const fake = createI18n("pt-BR");

    await setAppLanguage("", asI18n(fake));

    expect(setLanguage).not.toHaveBeenCalled();
    expect(fake.changeLanguage).not.toHaveBeenCalled();
    expect(document.documentElement.lang).toBe("pt-BR");
  });

  it("ignores an unsupported language", async () => {
    const fake = createI18n("en");

    await setAppLanguage("fr", asI18n(fake));

    expect(setLanguage).not.toHaveBeenCalled();
    expect(fake.changeLanguage).not.toHaveBeenCalled();
  });
});

describe("updateAppLanguage", () => {
  it("restores the stored language from the main process", async () => {
    getPreferences.mockResolvedValue({ language: "pt-BR", theme: "system" });
    const fake = createI18n("en");

    await updateAppLanguage(asI18n(fake));

    expect(getPreferences).toHaveBeenCalledTimes(1);
    expect(fake.changeLanguage).toHaveBeenCalledWith("pt-BR");
    expect(fake.language).toBe("pt-BR");
    expect(document.documentElement.lang).toBe("pt-BR");
  });
});
