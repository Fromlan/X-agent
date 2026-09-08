/**
 * Thin entry: Electron app lifecycle only. 主题 E #62 收口.
 *
 * 7 个 module 接管原 388 行 god:
 * - main-debug: AUMID + app icon + DevTools 快捷键
 * - main-splash: splash 窗口生命周期
 * - main-protocol: x-agent-logos:// 自定义协议
 * - main-nav-guard: 窗口导航守卫 + openExternalHttpUrl
 * - boot/main-window: BrowserWindow 构造 + nav/debug/focus 三件副作用
 * - boot/app-init: bootApp (动态 import app-runtime + apply startup logo)
 *
 * 本文件只剩单实例锁 + app event handlers + 6 段 wiring, < 100 行.
 */
import { app, BrowserWindow, Menu } from "electron";
import { getCachedPrefs } from "./agent/prefs";
import { appIcon, hasDebugArgument, enableDebugMode, setWindowsAumidIfNeeded } from "./main-debug";
import { createRevealMain, createSplash, destroySplashImmediate } from "./main-splash";
import { registerLogoProtocolHandler, registerLogoProtocolPrivileges } from "./main-protocol";
import { openExternalHttpUrl } from "./main-nav-guard";
import { createMainWindow } from "./boot/main-window";
import { bootApp, getRuntime } from "./boot/app-init";

/** E2E/并行测试放开单实例锁: 置 1 时即使已有实例运行也继续启动. */
const ALLOW_MULTI_INSTANCE_ENV = "X_AGENT_ALLOW_MULTI";

let mainWindow: BrowserWindow | null = null;
const revealMain = createRevealMain({ getMainWindow: () => mainWindow });

function onMainWindowClosed(): void {
  mainWindow = null;
}

/** bootApp 公共 deps 闭包 (main.ts 内部状态). */
function bootDeps() {
  return {
    getMainWindow: () => mainWindow,
    revealMain,
    openExternalHttpUrl,
    getCachedPrefs,
    createMainWindow: (opts: {
      getMainWindow: () => BrowserWindow | null;
      revealMain: () => void;
      onClosed?: () => void;
    }) => {
      const win = createMainWindow(opts);
      if (win) mainWindow = win;
      return win;
    },
    onMainWindowClosed,
  };
}

// Windows taskbar 用 AUMID 识别应用并缓存图标. 设置稳定 AUMID 之后,
// 运行时 BrowserWindow.setIcon 才会被 taskbar 接受, 否则系统会一直用
// 打包时的 .ico (electron-builder 烘焙的那张).
setWindowsAumidIfNeeded();
registerLogoProtocolPrivileges();

app.whenReady().then(() => {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock && process.env[ALLOW_MULTI_INSTANCE_ENV] !== "1") {
    app.quit();
    return;
  }
  app.on("second-instance", (_event, commandLine) => {
    if (hasDebugArgument(commandLine)) enableDebugMode(mainWindow);
    if (!mainWindow || mainWindow.isDestroyed()) {
      createSplash(appIcon);
      setImmediate(() => void bootApp(bootDeps()));
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    revealMain();
  });

  Menu.setApplicationMenu(null);
  registerLogoProtocolHandler();

  createSplash(appIcon);
  setImmediate(() => void bootApp(bootDeps()));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createSplash(appIcon);
      setImmediate(() => void bootApp(bootDeps()));
    }
  });
});

app.on("window-all-closed", async () => {
  destroySplashImmediate();
  await getRuntime()?.shutdownRuntime();
  if (process.platform !== "darwin") app.quit();
});
