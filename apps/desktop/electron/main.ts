/**
 * Thin entry: Electron + splash only.
 * Heavy agent/IPC loads via dynamic import after splash is visible.
 */
import { app, BrowserWindow, Menu, shell } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateExternalHttpUrl } from "./agent/external-url";

const BG = "#141414";
const SPLASH_TIMEOUT_MS = 30_000;

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let revealed = false;
let splashTimer: ReturnType<typeof setTimeout> | null = null;
let runtime: typeof import("./app-runtime") | null = null;

function alive(win: BrowserWindow | null): win is BrowserWindow {
  return !!win && !win.isDestroyed();
}

function appIcon(): string | undefined {
  const roots = app.isPackaged
    ? [process.resourcesPath]
    : [join(__dirname, "../../build")];
  for (const root of roots) {
    for (const name of ["icon.ico", "icon.png"]) {
      const p = join(root, name);
      if (existsSync(p)) return p;
    }
  }
}

function destroySplash(): void {
  if (splashTimer) {
    clearTimeout(splashTimer);
    splashTimer = null;
  }
  if (alive(splashWindow)) splashWindow.destroy();
  splashWindow = null;
}

function revealMain(): void {
  if (revealed) return;
  revealed = true;
  destroySplash();
  if (alive(mainWindow)) {
    mainWindow.show();
    mainWindow.focus();
  }
}

async function openExternalHttpUrl(
  url: string,
): Promise<{ ok: boolean; error?: string }> {
  const checked = validateExternalHttpUrl(url);
  if (!checked.ok) return checked;
  try {
    await shell.openExternal(checked.href);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "无效链接",
    };
  }
}

function createSplash(): void {
  if (alive(splashWindow)) return;
  const icon = appIcon();
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    thickFrame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    center: true,
    show: true,
    backgroundColor: BG,
    autoHideMenuBar: true,
    skipTaskbar: true,
    hasShadow: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void splashWindow.loadFile(
    app.isPackaged
      ? join(__dirname, "../renderer/splash.html")
      : join(__dirname, "../../public/splash.html"),
  );
  splashWindow.on("closed", () => {
    splashWindow = null;
  });
}

function createMain(): void {
  if (alive(mainWindow)) return;
  revealed = false;
  const icon = appIcon();
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 560,
    title: "X-agent",
    backgroundColor: BG,
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalHttpUrl(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url === mainWindow?.webContents.getURL()) return;
    if (rendererUrl && url.startsWith(rendererUrl)) return;
    if (url.startsWith("file:")) {
      // Packaged app: only allow navigation within our renderer directory.
      try {
        const rendererRoot = pathToFileURL(
          join(__dirname, "../renderer") + "/",
        ).href;
        if (url.startsWith(rendererRoot)) return;
      } catch {
        // fall through to deny
      }
      event.preventDefault();
      return;
    }
    event.preventDefault();
    void openExternalHttpUrl(url);
  });

  if (rendererUrl) mainWindow.loadURL(rendererUrl);
  else mainWindow.loadFile(join(__dirname, "../renderer/index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
    destroySplash();
  });

  if (splashTimer) clearTimeout(splashTimer);
  splashTimer = setTimeout(revealMain, SPLASH_TIMEOUT_MS);
}

async function bootApp(): Promise<void> {
  if (!runtime) {
    runtime = await import("./app-runtime");
    runtime.bootRuntime({
      getMainWindow: () => mainWindow,
      revealMainWindow: revealMain,
      openExternalHttpUrl,
    });
  }
  createMain();
}

app.whenReady().then(() => {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    if (!alive(mainWindow)) {
      createSplash();
      setImmediate(() => void bootApp());
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    revealMain();
  });

  Menu.setApplicationMenu(null);
  createSplash();
  setImmediate(() => void bootApp());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createSplash();
      setImmediate(() => void bootApp());
    }
  });
});

app.on("window-all-closed", async () => {
  destroySplash();
  await runtime?.shutdownRuntime();
  if (process.platform !== "darwin") app.quit();
});
