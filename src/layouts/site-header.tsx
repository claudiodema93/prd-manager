import { useLocation } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import LangToggle from "@/components/lang-toggle";
import ToggleTheme from "@/components/toggle-theme";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { getPageTitleKey } from "@/utils/page-title";

export default function SiteHeader(props: ComponentProps<"header">) {
  const { t } = useTranslation();
  const pathname = useLocation({ select: (location) => location.pathname });

  // The header sits inside the rounded SidebarInset: matching the radius on its
  // own background keeps the card's top corners rounded instead of squaring
  // them off.
  return (
    <header
      className="bg-background flex h-14 shrink-0 items-center justify-between gap-2 rounded-t-xl border-b px-4"
      {...props}
    >
      <div className="flex items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <Separator
          className="mr-2 data-[orientation=vertical]:h-4"
          orientation="vertical"
        />
        <h1 className="text-sm font-medium">{t(getPageTitleKey(pathname))}</h1>
      </div>
      <div className="flex items-center gap-1">
        <LangToggle />
        <ToggleTheme />
      </div>
    </header>
  );
}
