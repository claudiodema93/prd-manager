import { useLocation } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import LangToggle from "./lang-toggle";
import ToggleTheme from "./toggle-theme";

const PAGE_TITLE_KEYS: Record<string, string> = {
  "/": "titleHomePage",
  "/second": "titleSecondPage",
};

export default function SiteHeader(props: ComponentProps<"header">) {
  const { t } = useTranslation();
  const pathname = useLocation({ select: (location) => location.pathname });
  const titleKey = PAGE_TITLE_KEYS[pathname] ?? "appName";

  return (
    <header
      className="bg-background/80 sticky top-0 flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4 backdrop-blur"
      {...props}
    >
      <div className="flex items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <Separator
          className="mr-2 data-[orientation=vertical]:h-4"
          orientation="vertical"
        />
        <h1 className="text-sm font-medium">{t(titleKey)}</h1>
      </div>
      <div className="flex items-center gap-1">
        <LangToggle />
        <ToggleTheme />
      </div>
    </header>
  );
}
