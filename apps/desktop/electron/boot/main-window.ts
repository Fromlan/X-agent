/**
 * 主窗口构造 (主题 E #62 拆分, 2026-09-08).
 *
 * 从 main.ts 抽离 BrowserWindow 配置 + nav-guard / debug 快捷键 / 焦点 auth
 * 缓存失效, 让 main.ts 只剩 composition root + app lifecycle.
 */
import { app, BrowserWindow } from "electron";
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
const MIN_WIDTH = 1188;
const MIN_HEIGHT = 800;

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
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
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
  win.setMinimumSize(MIN_WIDTH, MIN_HEIGHT);

  installDebugShortcuts(win);
  // E1: 窗口获得焦点时 auth.json 可能已被外部 `pi /login` 改写,
  // 立即失效缓存, 让 ReadyChecklist 在本次运行内也能看到认证状态.
  win.on("focus", () => invalidateAuthCache());
  installWindowOpenHandler(win);
  installWillNavigateHandler(win, rendererUrl);

  if (rendererUrl) win.loadURL(rendererUrl);
  else win.loadFile(join(__dirname, "../renderer/index.html"));

  autoOpenDevTools(win);

  win.on("closed", () => {
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
