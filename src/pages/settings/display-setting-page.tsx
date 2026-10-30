import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { setAppLanguage } from "@/actions/language";
import { setTheme as applyTheme, getThemeState } from "@/actions/theme";
import ContentSection from "@/components/settings/content-section";
import LanguageSelector from "@/components/settings/language-selector";
import ThemeSelector from "@/components/settings/theme-selector";
import { isLanguageKey } from "@/localization/langs";
import { isThemeSource, type ThemeSource } from "@/types/theme-mode";

export default function DisplaySettingPage() {
  const { t, i18n } = useTranslation();
  const [themeSource, setThemeSource] = useState<ThemeSource>("system");

  useEffect(() => {
    let active = true;

    getThemeState()
      .then((state) => {
        if (active) {
          setThemeSource(state.source);
        }
      })
      .catch((error: unknown) => {
        console.error("Failed to read the current theme:", error);
      });

    return () => {
      active = false;
    };
  }, []);

  function handleThemeChange(next: ThemeSource) {
    if (!isThemeSource(next)) {
      return;
    }

    applyTheme(next)
      .then((state) => {
        setThemeSource(state.source);
      })
      .catch((error: unknown) => {
        console.error("Failed to change the theme:", error);
      });
  }

  function handleLanguageChange(next: string) {
    if (!isLanguageKey(next)) {
      return;
    }

    setAppLanguage(next, i18n).catch((error: unknown) => {
      console.error("Failed to change the language:", error);
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t("displayTitle")}
        </h2>
        <p className="text-muted-foreground text-sm">
          {t("displayDescription")}
        </p>
      </header>
      <ContentSection
        description={t("themeDescription")}
        title={t("themeLabel")}
      >
        <ThemeSelector onChange={handleThemeChange} value={themeSource} />
      </ContentSection>
      <ContentSection
        description={t("languageDescription")}
        title={t("languageLabel")}
      >
        <LanguageSelector
          onChange={handleLanguageChange}
          value={i18n.language}
        />
      </ContentSection>
    </div>
  );
}
