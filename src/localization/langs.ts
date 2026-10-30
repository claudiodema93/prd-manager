import type { Language } from "./language";

export const LANGUAGE_KEYS = ["en", "pt-BR"] as const;

export type LanguageKey = (typeof LANGUAGE_KEYS)[number];

export default [
  {
    key: "en",
    nativeName: "English",
    prefix: "EN-US",
  },
  {
    key: "pt-BR",
    nativeName: "Português (Brasil)",
    prefix: "PT-BR",
  },
] as const satisfies readonly (Language & { key: LanguageKey })[];
