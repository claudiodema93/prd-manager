import { type LucideIcon, Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { TranslationKey } from "@/localization/resources/it";
import { isThemeSource, type ThemeSource } from "@/types/theme-mode";

interface ThemeSelectorProps {
  onChange: (theme: ThemeSource) => void;
  value: ThemeSource;
}

interface ThemeOption {
  icon: LucideIcon;
  labelKey: TranslationKey;
  value: ThemeSource;
}

const THEME_OPTIONS: readonly ThemeOption[] = [
  { icon: Sun, labelKey: "themeLight", value: "light" },
  { icon: Moon, labelKey: "themeDark", value: "dark" },
  { icon: Monitor, labelKey: "themeSystem", value: "system" },
];

export default function ThemeSelector({ onChange, value }: ThemeSelectorProps) {
  const { t } = useTranslation();

  function handleValueChange(next: string) {
    if (!isThemeSource(next)) {
      return;
    }

    onChange(next);
  }

  return (
    <ToggleGroup
      aria-label={t("themeLabel")}
      onValueChange={handleValueChange}
      type="single"
      value={value}
    >
      {THEME_OPTIONS.map((option) => {
        const Icon = option.icon;

        return (
          <ToggleGroupItem
            className="gap-2"
            key={option.value}
            size="lg"
            value={option.value}
            variant="outline"
          >
            <Icon className="size-4" />
            <span>{t(option.labelKey)}</span>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
