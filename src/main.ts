import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog } from "electron";
import { ipcMain } from "electron/main";
import {
  installExtension,
  REACT_DEVELOPER_TOOLS,
} from "electron-devtools-installer";
import { UpdateSourceType, updateElectronApp } from "update-electron-app";
import { ipcContext } from "@/ipc/context";
import { IPC_CHANNELS, inDevelopment } from "./constants";
import { getBasePath } from "./utils/path";

function getRendererEntryPath() {
  return path.join(
    getBasePath(),
    `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`
  );
}

/**
 * Whether the main window may navigate to `target`.
 *
 * In development only the Vite dev-server origin is trusted; in production the
 * renderer uses in-memory routing, so the bundled entry document is the only
 * legitimate navigation target.
 */
function isAllowedNavigation(target: string): boolean {
  try {
    const url = new URL(target);

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      return url.origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin;
    }

    return url.toString() === pathToFileURL(getRendererEntryPath()).toString();
  } catch {
    return false;
  }
}

function createWindow() {
  const basePath = getBasePath();
  const preload = path.join(basePath, "preload.cjs");
  const mainWindow = new BrowserWindow({
    height: 600,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    trafficLightPosition:
      process.platform === "darwin" ? { x: 5, y: 5 } : undefined,
    webPreferences: {
      contextIsolation: true,
      devTools: inDevelopment,
      // The renderer bundle only uses browser APIs (Vite inlines
      // `process.env.NODE_ENV` at build time), so it does not need Node.
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,

      preload,
      // The preload only uses `ipcRenderer` and DOM APIs to forward the
      // MessagePort, so it runs unchanged inside Electron's sandbox.
      sandbox: true,
    },
    width: 800,
  });
  ipcContext.setMainWindow(mainWindow);
  mainWindow.on("closed", () => {
    if (ipcContext.mainWindow === mainWindow) {
      ipcContext.mainWindow = undefined;
    }
  });

  // Never let the renderer spawn additional windows (`window.open`,
  // `target="_blank"`). External links go through the validated
  // `shell.openExternal` IPC procedure instead.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // Never let the app window navigate to a foreign origin or protocol. The
  // same rule applies to server redirects and to subframes (which may only stay
  // on about:blank).
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAllowedNavigation(url)) {
      return;
    }

    event.preventDefault();
    console.warn("[security] Blocked a navigation away from the app.");
  });

  mainWindow.webContents.on("will-redirect", (details) => {
    const allowed = details.isMainFrame
      ? isAllowedNavigation(details.url)
      : details.url === "about:blank";

    if (!allowed) {
      details.preventDefault();
      console.warn("[security] Blocked a redirect away from the app.");
    }
  });

  mainWindow.webContents.on("will-frame-navigate", (details) => {
    const allowed = details.isMainFrame
      ? isAllowedNavigation(details.url)
      : details.url === "about:blank";

    if (!allowed) {
      details.preventDefault();
      console.warn("[security] Blocked a frame navigation.");
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(getRendererEntryPath());
  }
}

async function installExtensions() {
  try {
    const result = await installExtension(REACT_DEVELOPER_TOOLS);
    console.log(`Extensions installed successfully: ${result.name}`);
  } catch {
    console.error("Failed to install extensions");
  }
}

function checkForUpdates() {
  updateElectronApp({
    updateSource: {
      repo: "claudiodema93/prd-manager",
      type: UpdateSourceType.ElectronPublicUpdateService,
    },
  });
}

async function initializeDatabase(): Promise<boolean> {
  try {
    // Imported lazily so that a native-module load failure stays inside this
    // try/catch instead of crashing before the error dialog can be shown.
    const { closeDatabase, initDatabase } = await import("@/db");
    initDatabase();
    app.once("will-quit", closeDatabase);

    return true;
  } catch (error) {
    console.error("[db] Fatal: unable to initialise the database.", error);
    dialog.showErrorBox(
      "Database error",
      "The local database could not be created, so the application will close."
    );
    app.exit(1);

    return false;
  }
}

async function setupORPC() {
  const { rpcHandler } = await import("./ipc/handler");

  ipcMain.on(IPC_CHANNELS.START_ORPC_SERVER, (event) => {
    const { mainWindow } = ipcContext;

    // Only the top frame of our own window may upgrade a MessagePort.
    if (
      !mainWindow ||
      event.sender !== mainWindow.webContents ||
      !event.senderFrame ||
      event.senderFrame.parent !== null
    ) {
      return;
    }

    const [serverPort] = event.ports;

    if (!serverPort) {
      return;
    }

    serverPort.start();
    rpcHandler.upgrade(serverPort);
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (hasSingleInstanceLock) {
  app.on("second-instance", () => {
    const { mainWindow } = ipcContext;

    // After the window was closed on macOS the reference is destroyed, and
    // calling show()/focus() on it would throw. Recreate it instead.
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      if (!(await initializeDatabase())) {
        return;
      }

      // The renderer posts its MessagePort while evaluating its bundle, so the
      // oRPC listener must be registered before the window is created.
      await setupORPC();
      createWindow();
      checkForUpdates();

      // DevTools extensions are fetched from the Chrome Web Store at runtime;
      // never do that in a production build.
      if (inDevelopment) {
        await installExtensions();
      }
    } catch (error) {
      console.error("Error during app initialization:", error);
    }
  });
} else {
  app.quit();
}

//osX only
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
//osX only ends
