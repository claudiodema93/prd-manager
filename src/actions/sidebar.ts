import { ipc } from "@/ipc/manager";

/**
 * The sidebar state lives in electron-store with the other preferences rather
 * than in a cookie: the packaged renderer is served from `file://`, where
 * Chromium does not persist cookies.
 */
export async function getSidebarOpen(): Promise<boolean> {
  const { sidebarOpen } = await ipc.client.preferences.getPreferences();

  return sidebarOpen;
}

export async function setSidebarOpenPreference(open: boolean): Promise<void> {
  await ipc.client.preferences.setSidebarOpen({ open });
}
