import path from "node:path";
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
      nodeIntegration: true,
      nodeIntegrationInSubFrames: false,

      preload,
    },
    width: 800,
  });
  ipcContext.setMainWindow(mainWindow);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(basePath, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
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
      repo: "LuanRoger/electron-shadcn",
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
    const [serverPort] = event.ports;

    serverPort.start();
    rpcHandler.upgrade(serverPort);
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (hasSingleInstanceLock) {
  app.on("second-instance", () => {
    const { mainWindow } = ipcContext;

    if (!mainWindow) {
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
      await installExtensions();
      checkForUpdates();
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
