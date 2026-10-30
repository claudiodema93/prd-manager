import { ipc } from "@/ipc/manager";
import type {
  OpenDirectoryDialogInput,
  OpenFileDialogInput,
} from "@/types/dialog";

export type {
  OpenDirectoryDialogInput,
  OpenFileDialogInput,
} from "@/types/dialog";

export function openFileDialog(input: OpenFileDialogInput = {}) {
  return ipc.client.dialog.openFile(input);
}

export function openDirectoryDialog(input: OpenDirectoryDialogInput = {}) {
  return ipc.client.dialog.openDirectory(input);
}
