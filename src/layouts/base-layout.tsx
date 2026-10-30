import type React from "react";
import DragWindowRegion from "@/components/drag-window-region";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppSidebar from "@/layouts/app-sidebar";
import SiteHeader from "@/layouts/site-header";

export default function BaseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col overflow-hidden">
        {/* The window is frameless: the drag region stays above the sidebar
            so the whole title-bar strip remains draggable. */}
        <DragWindowRegion title="PrdManager" />
        {/* The sidebar open state is deliberately not persisted: it resets to
            open on every launch. */}
        <SidebarProvider className="relative min-h-0 flex-1">
          <AppSidebar />
          <SidebarInset className="min-h-0">
            <SiteHeader />
            <div className="flex flex-1 flex-col overflow-auto p-4">
              {children}
            </div>
          </SidebarInset>
        </SidebarProvider>
      </div>
    </TooltipProvider>
  );
}
