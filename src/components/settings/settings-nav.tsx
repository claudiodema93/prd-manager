import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "cn";
import { FolderOpen, type LucideIcon, Monitor, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { buttonVariants } from "@/components/ui/button";
import type { TranslationKey } from "@/localization/resources/it";

interface SettingsNavItem {
  icon: LucideIcon;
  labelKey: TranslationKey;
  to: "/settings" | "/settings/display" | "/settings/folders";
}

const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  { icon: Settings2, labelKey: "settingsNavGeneral", to: "/settings" },
  { icon: Monitor, labelKey: "settingsNavDisplay", to: "/settings/display" },
  { icon: FolderOpen, labelKey: "settingsNavFolders", to: "/settings/folders" },
];

export default function SettingsNav() {
  const { t } = useTranslation();
  const pathname = useLocation({ select: (location) => location.pathname });

  return (
    <nav aria-label={t("settings")}>
      <ul className="flex flex-row gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {SETTINGS_NAV_ITEMS.map((item) => {
          const isActive = pathname === item.to;
          const Icon = item.icon;

          return (
            <li key={item.to}>
              <Link
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  buttonVariants({ variant: "ghost" }),
                  "justify-start",
                  isActive && "bg-muted"
                )}
                to={item.to}
              >
                <Icon className="size-4" />
                <span>{t(item.labelKey)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
