/**
 * 主窗口构造 (主题 E #62 拆分, 2026-09-08).
 *
 * 从 main.ts 抽离 BrowserWindow 配置 + nav-guard / debug 快捷键 / 焦点 auth
 * 缓存失效, 让 main.ts 只剩 composition root + app lifecycle.
 */
import { app, BrowserWindow, screen, dialog } from "electron";
import { recordDiagnostic } from "./diagnostics";
import { fitWindow, windowGeometry } from "./window-geometry";
import { join } from "node:path";
import { invalidateAuthCache } from "../agent/auth-check";
import {
  appIcon,
  autoOpenDevTools,
  installDebugShortcuts,
} from "../main-debug";
import {
  installWillNavigateHandler,
  installWindowOpenHandler,
} from "../main-nav-guard";
import {
  destroySplashImmediate,
  scheduleSplashRevealTimeout,
} from "../main-splash";

const BG = "#141414";
const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;

/**
 * 主窗口工厂. 同时安装 nav-guard / debug shortcuts / focus → auth cache
 * invalidation 三件副作用;返回 BrowserWindow 供 main.ts 保存到 module 作用域.
 *
 * 幂等: `getMainWindow()` 已存在且未销毁时返回 null, 由 main.ts 自己处理.
 *
 * `revealMain` 传给 splash timeout fallback (`scheduleSplashRevealTimeout`).
 */
export function createMainWindow(opts: {
  getMainWindow: () => BrowserWindow | null;
  revealMain: () => void;
  /** 主窗口 closed 时同步 main.ts 内部的 mainWindow 引用. */
  onClosed?: () => void;
}): BrowserWindow | null {
  const existing = opts.getMainWindow();
  if (existing && !existing.isDestroyed()) return null;
  const icon = appIcon();
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  const geometry = windowGeometry(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea);
  const win = new BrowserWindow({
    ...geometry,
    title: "X-agent",
    backgroundColor: BG,
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // E5: 开启 sandbox — preload 仅使用 electron 受限 API + 内联常量,
      // 无需完整 Node 权限;contextBridge 不再是唯一防线.
      sandbox: true,
      devTools: true,
    },
  });

  // Explicit hard floor — guards against Win11 Snap Layout / DPI bypass
  // of the constructor `minWidth/minHeight` hint.
  win.setMinimumSize(geometry.minWidth, geometry.minHeight);
  /** Recompute DIP limits after monitor/DPI changes without repeatedly resizing a fitting window. */
  const fitDisplay = () => {
    if (win.isDestroyed() || win.isMinimized()) return;
    const bounds = win.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const limits = windowGeometry(area);
    win.setMinimumSize(limits.minWidth, limits.minHeight);
    const fitted = fitWindow(bounds, area);
    if (Object.keys(fitted).some((key) => fitted[key as keyof typeof fitted] !== bounds[key as keyof typeof fitted])) win.setBounds(fitted);
  };
  screen.on("display-metrics-changed", fitDisplay);
  win.on("moved", fitDisplay);

  installDebugShortcuts(win);
  // E1: 窗口获得焦点时 auth.json 可能已被外部 `pi /login` 改写,
  // 立即失效缓存, 让 ReadyChecklist 在本次运行内也能看到认证状态.
  win.on("focus", () => invalidateAuthCache());
  installWindowOpenHandler(win);
  installWillNavigateHandler(win, rendererUrl);
  win.webContents.on("render-process-gone", async (_event, details) => {
    if (details.reason === "clean-exit") return;
    recordDiagnostic("renderer-gone", details.reason);
    try { await (await import("../app-runtime")).stopTurnForRecovery(); }
    catch { recordDiagnostic("main-rejection", "unknown"); }
    const choice = await dialog.showMessageBox({ type: "error", title: "界面进程已停止", message: "已停止当前回合。重新启动后可恢复已保存会话；本地诊断仅保存崩溃类型。", buttons: ["重新启动", "退出"], defaultId: 0, cancelId: 1 });
    if (choice.response === 0) app.relaunch();
    app.quit();
  });

  if (rendererUrl) win.loadURL(rendererUrl);
  else win.loadFile(join(__dirname, "../renderer/index.html"));

  autoOpenDevTools(win);

  win.on("closed", () => {
    screen.removeListener("display-metrics-changed", fitDisplay);
    // mainWindow 在 main.ts 维护; 这里只负责收尾 splash
    destroySplashImmediate();
    opts.onClosed?.();
  });

  scheduleSplashRevealTimeout(opts.revealMain);
  return win;
}

/** app icon / preload 路径解析 (供 main.ts 单测与 createMainWindow 共用). */
export const MAIN_WINDOW_CONSTANTS = {
  BG,
  MIN_WIDTH,
  MIN_HEIGHT,
} as const;
