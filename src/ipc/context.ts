import { os } from "@orpc/server";
import type { BrowserWindow } from "electron";

class IPCContext {
  mainWindow: BrowserWindow | undefined;

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  get mainWindowContext() {
    return os.middleware(({ next }) => {
      const { mainWindow } = this;

      if (!mainWindow) {
        throw new Error("Main window is not set in IPC context.");
      }

      return next({
        context: {
          window: mainWindow,
        },
      });
    });
  }
}

export const ipcContext = new IPCContext();
