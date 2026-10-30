import { ipc } from "@/ipc/manager";
import type { FolderKey, FolderPreferences } from "@/types/preferences";

export function getFolderPreferences(): Promise<FolderPreferences> {
  return ipc.client.preferences.getFolders();
}

export function setFolderPreference(
  key: FolderKey,
  directory: string | null
): Promise<FolderPreferences> {
  return ipc.client.preferences.setFolder({ directory, key });
}
