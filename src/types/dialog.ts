import type { z } from "zod";
import type {
  openDirectoryDialogInputSchema,
  openFileDialogInputSchema,
} from "@/ipc/dialog/schemas";

export type OpenFileDialogInput = z.input<typeof openFileDialogInputSchema>;
export type OpenDirectoryDialogInput = z.input<
  typeof openDirectoryDialogInputSchema
>;
