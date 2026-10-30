import { ipcRenderer } from "electron";
import { IPC_CHANNELS } from "./constants";

window.addEventListener("message", (event) => {
  // Only the app's own top-level window may start the RPC server, and a port
  // must be present.
  if (event.source !== window) {
    return;
  }

  if (event.data !== IPC_CHANNELS.START_ORPC_SERVER) {
    return;
  }

  const [serverPort] = event.ports;

  if (!serverPort) {
    return;
  }

  ipcRenderer.postMessage(IPC_CHANNELS.START_ORPC_SERVER, null, [serverPort]);
});
