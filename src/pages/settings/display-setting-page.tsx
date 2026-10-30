import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { setAppLanguage } from "@/actions/language";
import {
  setTheme as applyTheme,
  getThemeState,
  subscribeToTheme,
} from "@/actions/theme";
import ContentSection from "@/components/settings/content-section";
import LanguageSelector from "@/components/settings/language-selector";
import ThemeSelector from "@/components/settings/theme-selector";
import { isLanguageKey } from "@/localization/langs";
import { isThemeSource, type ThemeSource } from "@/types/theme-mode";

export default function DisplaySettingPage() {
  const { t, i18n } = useTranslation();
  const [themeSource, setThemeSource] = useState<ThemeSource>("system");
  // Guards the initial read: if the user picks a theme before it resolves, the
  // late response must not overwrite the newer selection.
  const hasSelectedTheme = useRef(false);

  useEffect(() => {
    let active = true;
    let receivedThemeChange = false;
    const unsubscribe = subscribeToTheme((state) => {
      receivedThemeChange = true;

      if (active) {
        setThemeSource(state.source);
      }
    });

    getThemeState()
      .then((state) => {
        // A notification (from this page or the header) that arrives before
        // this read resolves is newer than the read itself.
        if (active && !hasSelectedTheme.current && !receivedThemeChange) {
          setThemeSource(state.source);
        }
      })
      .catch((error: unknown) => {
        console.error("Failed to read the current theme:", error);
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  function handleThemeChange(next: ThemeSource) {
    if (!isThemeSource(next)) {
      return;
    }

    hasSelectedTheme.current = true;
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
