import type React from "react";
import { useEffect, useRef, useState } from "react";
import { getSidebarOpen, setSidebarOpenPreference } from "@/actions/sidebar";
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
  // The sidebar starts open for the first paint and adopts the stored value as
  // soon as the IPC round-trip resolves. The window is shown on `ready-to-show`,
  // before that round-trip finishes, so a stored `false` can flash open once
  // before collapsing.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // A toggle that lands while the read is in flight wins: the read was issued
  // before the write, so applying it would undo the user's action.
  const userToggled = useRef(false);

  useEffect(() => {
    let active = true;

    getSidebarOpen()
      .then((open) => {
        if (active && !userToggled.current) {
          setSidebarOpen(open);
        }
      })
      .catch((error: unknown) => {
        console.error("Failed to read the sidebar state:", error);
      });

    return () => {
      active = false;
    };
  }, []);

  function handleSidebarOpenChange(open: boolean) {
    userToggled.current = true;
    setSidebarOpen(open);

    // A failed write must not block the toggle: the new state is already
    // applied for this session.
    setSidebarOpenPreference(open).catch((error: unknown) => {
      console.error("Failed to persist the sidebar state:", error);
    });
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col overflow-hidden">
        {/* The window is frameless: the drag region stays above the sidebar
            so the whole title-bar strip remains draggable. */}
        <DragWindowRegion title="PrdManager" />
        <SidebarProvider
          className="relative min-h-0 flex-1"
          onOpenChange={handleSidebarOpenChange}
          open={sidebarOpen}
        >
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
