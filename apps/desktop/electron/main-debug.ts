/**
 * Debug 模式 + DevTools 工具 (主题 E #62 PR-Y7 拆分, 2026-08-31).
 *
 * - debug mode 检测: CLI 参数 (--x-agent-debug / --debug-ui) + 环境变量 X_AGENT_DEBUG
 *   未打包运行时默认开启, 打包后仅在显式开启
 * - DevTools 独立窗口: openDebugTools / toggleDebugTools
 * - 快捷键: F12 / Ctrl+Shift+I (F12 与 Ctrl+Shift+I 共用此入口, 避免依赖已被隐藏的应用菜单)
 * - 运行时升级: enableDebugMode() (用于 second-instance 收到 --x-agent-debug 时)
 */
import { app, BrowserWindow } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DEBUG_ARGUMENTS = new Set(["--x-agent-debug", "--debug-ui"]);
const DEBUG_ENV_NAME = "X_AGENT_DEBUG";

/**
 * 判断启动参数是否明确要求打开 X-agent 调试工具。
 * 通过自定义参数支持已打包的 Windows exe，避免与 Electron 自身的 --debug 参数冲突。
 */
export function hasDebugArgument(args: readonly string[]): boolean {
  return args.some((arg) => DEBUG_ARGUMENTS.has(arg));
}

/**
 * 判断开发环境变量是否开启调试模式。
 * 接受 1 / true / yes，便于 PowerShell、npm script 和 CI 统一传递。
 */
export function hasDebugEnvironment(): boolean {
  return /^(1|true|yes)$/i.test(process.env[DEBUG_ENV_NAME] ?? "");
}

// 未打包运行时默认开启，打包后的安装版仅在 --x-agent-debug 或 X_AGENT_DEBUG 下开启。
let debugMode =
  !app.isPackaged || hasDebugArgument(process.argv) || hasDebugEnvironment();

/** Read debugMode from outside (用于 main.ts + 测试). */
export function isDebugMode(): boolean {
  return debugMode;
}

/** 打开当前窗口的独立 DevTools 窗口. */
function openDebugTools(win: BrowserWindow | null): void {
  if (!alive(win)) return;
  win.webContents.openDevTools({ mode: "detach" });
}

/** F12 与 Ctrl+Shift+I 共用此入口, 避免依赖已被隐藏的应用菜单. */
function toggleDebugTools(win: BrowserWindow | null): void {
  if (!alive(win) || !debugMode) return;
  if (win.webContents.isDevToolsOpened()) {
    win.webContents.closeDevTools();
  } else {
    openDebugTools(win);
  }
}

function alive(win: BrowserWindow | null): win is BrowserWindow {
  return !!win && !win.isDestroyed();
}

/**
 * 绑定调试快捷键.
 * 监听主进程 before-input-event, 因此打包版即使没有菜单也能打开 DevTools.
 */
export function installDebugShortcuts(win: BrowserWindow): void {
  win.webContents.on("before-input-event", (event, input) => {
    if (!debugMode || input.type !== "keyDown") return;
    const key = input.key.toLowerCase();
    const isToggleShortcut =
      input.key === "F12" || (input.control && input.shift && key === "i");
    if (!isToggleShortcut) return;
    event.preventDefault();
    toggleDebugTools(win);
  });
}

/**
 * 已运行的应用收到第二个带 --x-agent-debug 的启动请求时,
 * 切换到调试模式并立即显示 DevTools.
 */
export function enableDebugMode(win: BrowserWindow | null): void {
  debugMode = true;
  openDebugTools(win);
}

/** Render 后第一次自动打开 DevTools (debug 模式). */
export function autoOpenDevTools(win: BrowserWindow | null): void {
  if (!debugMode) return;
  if (!win) return;
  win.webContents.once("did-finish-load", () => {
    openDebugTools(win);
  });
}

/** Windows taskbar 用 AUMID 识别应用并缓存图标. 设置稳定 AUMID 之后,
 *  运行时 BrowserWindow.setIcon 才会被 taskbar 接受. */
export function setWindowsAumidIfNeeded(): void {
  if (process.platform === "win32") {
    app.setAppUserModelId("works.earendil.x-agent");
  }
}

/** 解析 app icon 路径 (dev / packaged 都支持). */
export function appIcon(): string | undefined {
  const roots = app.isPackaged
    ? [process.resourcesPath]
    : [join(__dirname, "../../build")];
  for (const root of roots) {
    for (const name of ["icon.ico", "icon.png"]) {
      const p = join(root, name);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}
