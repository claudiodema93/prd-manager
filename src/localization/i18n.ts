import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { it } from "./resources/it";

// To add a language, add `resources/<code>.ts` exporting the same keys as
// `it.ts`, then register it in `resources` below and add it to `langs.ts`.
i18n.use(initReactI18next).init({
  fallbackLng: "it",
  interpolation: {
    escapeValue: false,
  },
  lng: "it",
  resources: {
    it: {
      translation: it,
    },
  },
});
