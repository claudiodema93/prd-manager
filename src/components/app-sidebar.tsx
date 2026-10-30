import { Link, useLocation } from "@tanstack/react-router";
import { BookOpen, House, Layers, LayoutDashboard } from "lucide-react";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import ExternalLink from "@/components/external-link";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

const DOCUMENTATION_URL = "https://github.com/claudiodema93/prd-manager";

export default function AppSidebar(props: ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation();
  // `useLocation` selects only the pathname, so the sidebar re-renders on
  // navigation without subscribing to search or hash changes.
  // Source: https://tanstack.com/router/latest/docs/api/router/useLocationHook
  const pathname = useLocation({ select: (location) => location.pathname });

  return (
    <Sidebar
      // shadcn positions the desktop sidebar with `fixed inset-y-0 h-svh`,
      // which would cover the frameless window's drag strip. Anchoring it to
      // the (relative) SidebarProvider instead keeps it below title bar.
      className="absolute inset-y-0 h-full"
      collapsible="icon"
      variant="inset"
      {...props}
    >
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link to="/">
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <LayoutDashboard className="size-4" />
                </div>
                <span className="truncate font-semibold">{t("appName")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t("navigation")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === "/"}
                  tooltip={t("titleHomePage")}
                >
                  <Link to="/">
                    <House />
                    <span>{t("titleHomePage")}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === "/second"}
                  tooltip={t("titleSecondPage")}
                >
                  <Link to="/second">
                    <Layers />
                    <span>{t("titleSecondPage")}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip={t("documentation")}>
                  <ExternalLink href={DOCUMENTATION_URL}>
                    <BookOpen />
                    <span>{t("documentation")}</span>
                  </ExternalLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
