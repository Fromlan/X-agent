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
// 淡出动画时长需与 splash.html 中 body.leaving 的 transition 时长保持一致。
const SPLASH_FADE_OUT_MS = 320;

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let revealed = false;
let splashTimer: ReturnType<typeof setTimeout> | null = null;
let runtime: typeof import("./app-runtime") | null = null;

const DEBUG_ARGUMENTS = new Set(["--x-agent-debug", "--debug-ui"]);
const DEBUG_ENV_NAME = "X_AGENT_DEBUG";
/** E2E/并行测试放开单实例锁：置 1 时即使已有实例运行也继续启动。 */
const ALLOW_MULTI_INSTANCE_ENV = "X_AGENT_ALLOW_MULTI";

/**
 * 判断启动参数是否明确要求打开 X-agent 调试工具。
 * 通过自定义参数支持已打包的 Windows exe，避免与 Electron 自身的 --debug 参数冲突。
 */
function hasDebugArgument(args: readonly string[]): boolean {
  return args.some((arg) => DEBUG_ARGUMENTS.has(arg));
}

/**
 * 判断开发环境变量是否开启调试模式。
 * 接受 1 / true / yes，便于 PowerShell、npm script 和 CI 统一传递。
 */
function hasDebugEnvironment(): boolean {
  return /^(1|true|yes)$/i.test(process.env[DEBUG_ENV_NAME] ?? "");
}

// 未打包运行时默认开启，打包后的安装版仅在 --x-agent-debug 或 X_AGENT_DEBUG 下开启。
let debugMode =
  !app.isPackaged || hasDebugArgument(process.argv) || hasDebugEnvironment();

/**
 * 打开当前窗口的独立 DevTools 窗口。
 * 独立窗口不改变主界面布局，适合检查虚拟列表和 Electron IPC 日志。
 */
function openDebugTools(win: BrowserWindow | null): void {
  if (!alive(win)) return;
  win.webContents.openDevTools({ mode: "detach" });
}

/**
 * 在调试模式下切换 DevTools 显示状态。
 * F12 与 Ctrl+Shift+I 共用此入口，避免依赖已被隐藏的应用菜单。
 */
function toggleDebugTools(win: BrowserWindow | null): void {
  if (!alive(win) || !debugMode) return;
  if (win.webContents.isDevToolsOpened()) {
    win.webContents.closeDevTools();
  } else {
    openDebugTools(win);
  }
}

/**
 * 绑定调试快捷键。
 * 监听主进程 before-input-event，因此打包版即使没有菜单也能打开 DevTools。
 */
function installDebugShortcuts(win: BrowserWindow): void {
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
 * 将已运行的应用切换到调试模式，并立即显示 DevTools。
 * 用于普通实例收到第二个带 --x-agent-debug 参数的启动请求时。
 */
function enableDebugMode(): void {
  debugMode = true;
  openDebugTools(mainWindow);
}

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

/**
 * 触发启动页的淡出动画,等动画结束再真正销毁窗口。
 * 通过 webContents.executeJavaScript 注入 class,不受页面 CSP 对 inline script 的限制。
 */
async function fadeOutSplash(): Promise<void> {
  const win = splashWindow;
  if (!alive(win)) return;
  try {
    await win.webContents.executeJavaScript(
      "document.body.classList.add('leaving');"
    );
  } catch {
    // 注入失败(页面尚未就绪)时直接销毁,避免长时间白屏。
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, SPLASH_FADE_OUT_MS));
}

function revealMain(): void {
  if (revealed) return;
  revealed = true;
  // 先淡出再销毁,避免视觉跳变;主窗口稍晚一帧再显示,衔接更自然。
  void fadeOutSplash().finally(() => {
    destroySplash();
    if (alive(mainWindow)) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
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
    width: 420,
    height: 320,
    frame: false,
    thickFrame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    center: true,
    show: true,
    // 窗口背景设为透明,由内层 .inner 自绘圆角背景,保证在 Windows 10 / 11 / 老版本都呈现圆角。
    // backgroundColor 与 transparent 互斥,这里省略。
    transparent: true,
    autoHideMenuBar: true,
    skipTaskbar: true,
    hasShadow: false,
    // 双保险:Win11 22H2+ 也尝试走 DWM 原生圆角;低版本系统不生效也无所谓,因 HTML 圆角已生效。
    roundedCorners: true,
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
      devTools: true,
    },
  });

  installDebugShortcuts(mainWindow);
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

  if (debugMode) {
    mainWindow.webContents.once("did-finish-load", () => {
      openDebugTools(mainWindow);
    });
  }

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
  if (!gotLock && process.env[ALLOW_MULTI_INSTANCE_ENV] !== "1") {
    app.quit();
    return;
  }
  app.on("second-instance", (_event, commandLine) => {
    if (hasDebugArgument(commandLine)) enableDebugMode();
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
