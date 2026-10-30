import i18n from "i18next";
import { initReactI18next } from "react-i18next";

i18n.use(initReactI18next).init({
  fallbackLng: "en",
  resources: {
    en: {
      translation: {
        appName: "PrdManager",
        documentation: "Documentation",
        madeBy: "Made by Claudio De Martino",
        navigation: "Navigation",
        titleHomePage: "Home Page",
        titleSecondPage: "Second Page",
      },
    },
    "pt-BR": {
      translation: {
        appName: "PrdManager",
        documentation: "Documentação",
        madeBy: "Feito por Claudio De Martino",
        navigation: "Navegação",
        titleHomePage: "Página Inicial",
        titleSecondPage: "Segunda Página",
      },
    },
  },
});
