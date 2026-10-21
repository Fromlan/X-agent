/** Expose only the native actions needed to reproduce the reference title bar within the sender guard. */
import { app, type BrowserWindow, type IpcMain } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { handle } from "./register-ipc";

/** Keep frameless window controls on the main process and preserve native close lifecycle handling. */
export function registerWindowIpc(ipcMain: IpcMain, getMainWindow: () => BrowserWindow | null): void {
  const info = () => ({ maximized: getMainWindow()?.isMaximized() ?? false, version: app.getVersion() });
  handle(ipcMain, IPC_CHANNELS.getWindowInfo, info);
  handle(ipcMain, IPC_CHANNELS.controlWindow, (_event, action) => {
    if (action !== "minimize" && action !== "toggleMaximize" && action !== "close") throw new Error("不支持的窗口操作");
    const win = getMainWindow();
    if (!win || win.isDestroyed()) throw new Error("窗口已关闭");
    if (action === "minimize") win.minimize();
    else if (action === "toggleMaximize") {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else {
      // Let the invoke response leave before the renderer is destroyed by the native close lifecycle.
      setImmediate(() => { if (!win.isDestroyed()) win.close(); });
    }
    return info();
  });
}
