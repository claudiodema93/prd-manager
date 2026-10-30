import { useTranslation } from "react-i18next";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import langs from "@/localization/langs";

interface LanguageSelectorProps {
  onChange: (value: string) => void;
  value: string;
}

const SUPPORTED_LANGUAGE_KEYS = new Set<string>(langs.map((lang) => lang.key));

export default function LanguageSelector({
  onChange,
  value,
}: LanguageSelectorProps) {
  const { t } = useTranslation();

  function handleValueChange(next: string) {
    if (!SUPPORTED_LANGUAGE_KEYS.has(next)) {
      return;
    }

    onChange(next);
  }

  return (
    <ToggleGroup
      aria-label={t("languageLabel")}
      onValueChange={handleValueChange}
      type="single"
      value={value}
    >
      {langs.map((lang) => (
        <ToggleGroupItem
          key={lang.key}
          size="lg"
          value={lang.key}
          variant="outline"
        >
          {lang.nativeName}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
