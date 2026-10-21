/**
 * Thin entry: Electron app lifecycle only. 主题 E #62 收口.
 *
 * 启动逻辑由以下模块承担:
 * - main-debug: AUMID + app icon + DevTools 快捷键
 * - main-splash: splash 窗口生命周期
 * - main-nav-guard: 窗口导航守卫 + openExternalHttpUrl
 * - boot/main-window: BrowserWindow 构造 + nav/debug/focus 三件副作用
 * - boot/app-init: bootApp (动态 import app-runtime + create main window)
 *
 * 本文件只剩单实例锁 + app event handlers + 6 段 wiring, < 100 行.
 */
import { app, BrowserWindow, Menu, dialog } from "electron";
import { installProcessDiagnostics, recordDiagnostic } from "./boot/diagnostics";
import { appIcon, hasDebugArgument, enableDebugMode, setWindowsAumidIfNeeded } from "./main-debug";
import { createRevealMain, createSplash, destroySplashImmediate } from "./main-splash";
import { openExternalHttpUrl } from "./main-nav-guard";
import { createMainWindow } from "./boot/main-window";
import { bootApp, getRuntime } from "./boot/app-init";

/** E2E/并行测试放开单实例锁: 置 1 时即使已有实例运行也继续启动. */
const ALLOW_MULTI_INSTANCE_ENV = "X_AGENT_ALLOW_MULTI";

let mainWindow: BrowserWindow | null = null;
installProcessDiagnostics(process, () => {
  // Best-effort cancellation is bounded: never keep an unknown process state running while awaiting SDK cleanup.
  void Promise.race([
    getRuntime()?.stopTurnForRecovery().catch(() => {}) ?? Promise.resolve(),
    new Promise<void>((resolve) => setTimeout(resolve, 1000)),
  ]).then(() => {
    try {
      if (app.isReady()) dialog.showErrorBox("X-agent 发生异常", "程序已停止以保护会话。请重新启动；可在设置中导出本地诊断包。诊断只保存错误类型，不保存对话或密钥。");
    } finally { app.exit(1); }
  });
});
app.on("child-process-gone", (_event, details) => recordDiagnostic("child-gone", details.reason));
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

// Keep the stable application identity associated with the default packaged icon.
setWindowsAumidIfNeeded();

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
