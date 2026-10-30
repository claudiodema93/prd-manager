import type { i18n } from "i18next";
import { LOCAL_STORAGE_KEYS } from "@/constants";

export function setAppLanguage(lang: string, i18: i18n) {
  // Radix' ToggleGroup emits an empty string when the active item is clicked.
  if (!lang) {
    return;
  }

  localStorage.setItem(LOCAL_STORAGE_KEYS.LANGUAGE, lang);
  i18.changeLanguage(lang);
  document.documentElement.lang = lang;
}

export function updateAppLanguage(i18: i18n) {
  const localLang = localStorage.getItem(LOCAL_STORAGE_KEYS.LANGUAGE);

  if (localLang) {
    i18.changeLanguage(localLang);
  }

  // Always expose the active language, including on first launch where no
  // preference has been stored yet.
  document.documentElement.lang = i18.language;
}
