import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  nativeTheme,
  screen,
  session,
} from "electron";
import { ipcMain } from "electron/main";
import started from "electron-squirrel-startup";
import { UpdateSourceType, updateElectronApp } from "update-electron-app";
import { ipcContext } from "@/ipc/context";
import { WINDOW_MIN_HEIGHT, WINDOW_MIN_WIDTH } from "@/preferences/schema";
import {
  getThemePreference,
  getWindowState,
  initializePreferences,
  setWindowState,
} from "@/preferences/store";
import {
  resolveWindowState,
  showRestoredWindow,
} from "@/preferences/window-state";
import { IPC_CHANNELS } from "./constants";
import { getBasePath } from "./utils/path";

/**
 * macOS resolves `userData` through the OS account, not `$HOME`, so the e2e
 * helper cannot isolate the single-instance lock with environment variables.
 * The E2E build may point `userData` at its own temp directory instead.
 */
function configureE2EUserData(): void {
  if (process.env.APP_E2E !== "1") {
    return;
  }

  const directory = process.env.APP_USER_DATA_DIR?.trim();

  if (!directory) {
    return;
  }

  const resolved = path.resolve(directory);
  fs.mkdirSync(resolved, { recursive: true });
  app.setPath("userData", resolved);
}

configureE2EUserData();

/**
 * True only for an unpackaged (development) run.
 *
 * Do not use `NODE_ENV` here: Forge does not set it when starting the app, so
 * it is false during `electron-forge start` and, in a packaged build, it can be
 * spoofed by launching the binary with `NODE_ENV=development`.
 */
const isDevelopment = !app.isPackaged;

/** Native background colour, used to avoid a white flash before first paint. */
function getWindowBackgroundColor() {
  return nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#ffffff";
}

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

/**
 * The renderer needs no privileged web APIs: camera, microphone, clipboard,
 * geolocation, display capture, USB, HID, downloads, ... are all denied by
 * default. Anything that later needs one must be granted explicitly here.
 */
function hardenSession() {
  const { defaultSession } = session;

  defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => {
      callback(false);
    }
  );
  defaultSession.setPermissionCheckHandler(() => false);
  defaultSession.setDevicePermissionHandler(() => false);
  defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    callback({});
  });
  defaultSession.on("will-download", (event) => {
    event.preventDefault();
  });
}

let windowStateTimer: ReturnType<typeof setTimeout> | undefined;

function clearPendingWindowStateSave() {
  if (windowStateTimer) {
    clearTimeout(windowStateTimer);
    windowStateTimer = undefined;
  }
}

function persistWindowState(window: BrowserWindow) {
  if (window.isDestroyed()) {
    return;
  }

  // `getNormalBounds()` is the normal-state rectangle even when the window is
  // maximized, minimized or fullscreen, so the saved size stays usable.
  // Source: https://www.electronjs.org/docs/latest/api/browser-window#wingetnormalbounds
  const bounds = window.getNormalBounds();

  setWindowState({
    height: Math.round(bounds.height),
    isMaximized: window.isMaximized(),
    width: Math.round(bounds.width),
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
  });
}

function scheduleWindowStateSave(window: BrowserWindow) {
  clearPendingWindowStateSave();
  windowStateTimer = setTimeout(() => {
    windowStateTimer = undefined;
    persistWindowState(window);
  }, 250);
}

function createWindow() {
  const basePath = getBasePath();
  const preload = path.join(basePath, "preload.cjs");
  const savedWindow = resolveWindowState(
    getWindowState(),
    screen.getAllDisplays(),
    screen.getPrimaryDisplay()
  );
  const mainWindow = new BrowserWindow({
    backgroundColor: getWindowBackgroundColor(),
    height: savedWindow.height,
    minHeight: WINDOW_MIN_HEIGHT,
    minWidth: WINDOW_MIN_WIDTH,
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    trafficLightPosition:
      process.platform === "darwin" ? { x: 5, y: 5 } : undefined,
    webPreferences: {
      contextIsolation: true,
      devTools: isDevelopment,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,

      preload,
      safeDialogs: true,
      // The preload only uses `ipcRenderer` and DOM APIs to forward the
      // MessagePort, so it runs unchanged inside Electron's sandbox.
      sandbox: true,
      webviewTag: false,
    },
    width: savedWindow.width,
    ...(savedWindow.x === undefined || savedWindow.y === undefined
      ? {}
      : { x: savedWindow.x, y: savedWindow.y }),
  });
  ipcContext.setMainWindow(mainWindow);

  mainWindow.on("closed", () => {
    if (ipcContext.mainWindow === mainWindow) {
      ipcContext.mainWindow = undefined;
    }
  });

  // Persist resizes/moves while dragging, plus the final state on close. The
  // debounce keeps the JSON write off the drag path.
  mainWindow.on("resize", () => scheduleWindowStateSave(mainWindow));
  mainWindow.on("move", () => scheduleWindowStateSave(mainWindow));
  mainWindow.on("maximize", () => persistWindowState(mainWindow));
  mainWindow.on("unmaximize", () => persistWindowState(mainWindow));
  mainWindow.on("close", () => {
    clearPendingWindowStateSave();
    persistWindowState(mainWindow);
  });

  // The window starts hidden so it appears fully painted instead of flashing
  // an empty frame.
  mainWindow.once("ready-to-show", () => {
    showRestoredWindow(mainWindow, savedWindow.isMaximized);
  });

  // Never let the renderer spawn additional windows (`window.open`,
  // `target="_blank"`). External links go through the validated
  // `shell.openExternal` IPC procedure instead.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // Never let the app window navigate to a foreign origin or protocol. The
  // same rule applies to server redirects and to subframes (which may only stay
  // on about:blank).
  mainWindow.webContents.on("will-navigate", (details) => {
    if (isAllowedNavigation(details.url)) {
      return;
    }

    details.preventDefault();
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
    // Imported lazily: this pulls in a sizeable dependency tree that is only
    // needed for development.
    const { installExtension, REACT_DEVELOPER_TOOLS } = await import(
      "electron-devtools-installer"
    );

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

/**
 * Set once the oRPC listener is registered and the first window was created.
 * Until then the normal startup path owns window creation; `second-instance`
 * and `activate` must not race it (which would drop the MessagePort and/or
 * open a duplicate window).
 */
let startupComplete = false;

// Squirrel.Windows runs the app for install/update/uninstall events only.
// `electron-squirrel-startup` performs the shortcut work and quits; the app
// itself must not bootstrap in that case.
if (started) {
  app.quit();
} else {
  const hasSingleInstanceLock = app.requestSingleInstanceLock();

  if (hasSingleInstanceLock) {
    app.on("second-instance", () => {
      if (!startupComplete) {
        return;
      }

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
        hardenSession();

        // Preferences need `app.getPath("userData")`, so they are initialised
        // after `whenReady()`. Apply the stored theme before the window exists
        // so the first paint already has the right appearance.
        initializePreferences();
        nativeTheme.themeSource = getThemePreference();

        if (!(await initializeDatabase())) {
          return;
        }

        // The renderer posts its MessagePort while evaluating its bundle, so
        // the oRPC listener must be registered before the window is created.
        await setupORPC();
        createWindow();
        startupComplete = true;
        checkForUpdates();

        // DevTools extensions are fetched from the Chrome Web Store at runtime;
        // never do that in a production build.
        if (isDevelopment) {
          await installExtensions();
        }
      } catch (error) {
        console.error("Error during app initialization:", error);
      }
    });

    //osX only
    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") {
        app.quit();
      }
    });

    app.on("activate", () => {
      if (!startupComplete) {
        return;
      }

      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
    //osX only ends
  } else {
    app.quit();
  }
}
