import type { Language } from "./language";

export const LANGUAGE_KEYS = ["it"] as const;

export type LanguageKey = (typeof LANGUAGE_KEYS)[number];

export function isLanguageKey(value: string): value is LanguageKey {
  return (LANGUAGE_KEYS as readonly string[]).includes(value);
}

export default [
  {
    key: "it",
    nativeName: "Italiano",
    prefix: "IT",
  },
] as const satisfies readonly (Language & { key: LanguageKey })[];
