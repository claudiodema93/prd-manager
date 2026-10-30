import { ORPCError, os } from "@orpc/server";
import { type BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import { ipcContext } from "@/ipc/context";
import {
  openDialogOutputSchema,
  openDirectoryDialogInputSchema,
  openFileDialogInputSchema,
} from "./schemas";

type OpenMode = "openFile" | "openDirectory";
type DialogProperties = NonNullable<OpenDialogOptions["properties"]>;

function buildProperties(
  mode: OpenMode,
  multiple: boolean,
  showHiddenFiles: boolean
): DialogProperties {
  const properties: DialogProperties = [mode];

  if (multiple) {
    properties.push("multiSelections");
  }

  if (showHiddenFiles) {
    properties.push("showHiddenFiles");
  }

  return properties;
}

async function showOpenDialog(
  window: BrowserWindow,
  options: OpenDialogOptions
) {
  try {
    const result = await dialog.showOpenDialog(window, options);

    return {
      canceled: result.canceled,
      filePaths: result.filePaths,
    };
  } catch (error) {
    // Native dialog failures are unexpected. Keep the OS error out of the
    // renderer and let the oRPC interceptor log the 5xx.
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      cause: error,
      message: "Unable to open the dialog.",
    });
  }
}

export const openFile = os
  .use(ipcContext.mainWindowContext)
  .input(openFileDialogInputSchema)
  .output(openDialogOutputSchema)
  .handler(({ context, input }) =>
    showOpenDialog(context.window, {
      buttonLabel: input.buttonLabel,
      defaultPath: input.defaultPath,
      filters: input.filters,
      properties: buildProperties(
        "openFile",
        input.multiple,
        input.showHiddenFiles
      ),
      title: input.title,
    })
  );

export const openDirectory = os
  .use(ipcContext.mainWindowContext)
  .input(openDirectoryDialogInputSchema)
  .output(openDialogOutputSchema)
  .handler(({ context, input }) =>
    showOpenDialog(context.window, {
      buttonLabel: input.buttonLabel,
      defaultPath: input.defaultPath,
      properties: buildProperties(
        "openDirectory",
        input.multiple,
        input.showHiddenFiles
      ),
      title: input.title,
    })
  );
