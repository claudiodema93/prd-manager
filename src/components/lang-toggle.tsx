import { useTranslation } from "react-i18next";
import { setAppLanguage } from "@/actions/language";
import langs from "@/localization/langs";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

const SUPPORTED_LANGUAGES = new Set<string>(langs.map((lang) => lang.key));

export default function LangToggle() {
  const { i18n } = useTranslation();
  const currentLang = i18n.language;

  function onValueChange(value: string) {
    // Radix emits `""` when the active item is clicked again; unknown values
    // must not overwrite the stored preference either.
    if (!SUPPORTED_LANGUAGES.has(value)) {
      return;
    }

    setAppLanguage(value, i18n);
  }

  return (
    <ToggleGroup
      onValueChange={onValueChange}
      type="single"
      value={currentLang}
    >
      {langs.map((lang) => (
        <ToggleGroupItem
          key={lang.key}
          size="lg"
          value={lang.key}
          variant="outline"
        >
          {`${lang.prefix}`}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
