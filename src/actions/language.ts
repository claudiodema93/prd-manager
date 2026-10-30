import type { i18n } from "i18next";
import { ipc } from "@/ipc/manager";
import { LANGUAGE_KEYS, type LanguageKey } from "@/localization/langs";

function isLanguageKey(value: string): value is LanguageKey {
  return (LANGUAGE_KEYS as readonly string[]).includes(value);
}

export async function setAppLanguage(lang: string, i18: i18n): Promise<void> {
  // Radix' ToggleGroup emits an empty string when the active item is clicked.
  if (!isLanguageKey(lang)) {
    return;
  }

  await ipc.client.preferences.setLanguage({ language: lang });
  await i18.changeLanguage(lang);
  document.documentElement.lang = lang;
}

export async function updateAppLanguage(i18: i18n): Promise<void> {
  const { language } = await ipc.client.preferences.getPreferences();

  await i18.changeLanguage(language);
  document.documentElement.lang = i18.language;
}
