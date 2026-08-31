/**
 * Thin entry: Electron + splash only. 主题 E #62 PR-Y7 收口.
 *
 * 4 个 module 接管原 388 行 god:
 * - main-debug.ts: debug mode + DevTools + AUMID + app icon
 * - main-splash.ts: splash 窗口生命周期 (create / fade / destroy / timeout)
 * - main-protocol.ts: x-agent-logos:// 自定义协议
 * - main-nav-guard.ts: 外部 URL 导航守卫
 *
 * 本文件只剩 app.whenReady 编排 + 4 module 调用 + createMain 入口.
 */
import { app, BrowserWindow, Menu } from "electron";
import { join } from "node:path";
import { getCachedPrefs } from "./agent/prefs";
import { dbgWarn } from "../shared/debug-log";
import { invalidateAuthCache } from "./agent/auth-check";
import {
  appIcon,
  autoOpenDevTools,
  enableDebugMode,
  hasDebugArgument,
  installDebugShortcuts,
  setWindowsAumidIfNeeded,
} from "./main-debug";
import {
  createRevealMain,
  createSplash,
  destroySplashImmediate,
  scheduleSplashRevealTimeout,
} from "./main-splash";
import {
  registerLogoProtocolHandler,
  registerLogoProtocolPrivileges,
} from "./main-protocol";
import {
  installWillNavigateHandler,
  installWindowOpenHandler,
  openExternalHttpUrl,
} from "./main-nav-guard";

const BG = "#141414";

let mainWindow: BrowserWindow | null = null;
let runtime: typeof import("./app-runtime") | null = null;
const revealMain = createRevealMain({ getMainWindow: () => mainWindow });

/** E2E/并行测试放开单实例锁：置 1 时即使已有实例运行也继续启动。 */
const ALLOW_MULTI_INSTANCE_ENV = "X_AGENT_ALLOW_MULTI";

function createMain(): void {
  if (mainWindow && !mainWindow.isDestroyed()) return;
  const icon = appIcon();
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1188,
    minHeight: 800,
    title: "X-agent",
    backgroundColor: BG,
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // E5: 开启 sandbox —— preload 仅使用 electron 受限 API + 内联常量，
      // 无需完整 Node 权限；contextBridge 不再是唯一防线。
      sandbox: true,
      devTools: true,
    },
  });

  // Explicit hard floor — guards against Win11 Snap Layout / DPI bypass
  // of the constructor `minWidth/minHeight` hint.
  mainWindow.setMinimumSize(1188, 800);

  installDebugShortcuts(mainWindow);
  // E1: 窗口获得焦点时 auth.json 可能已被外部 `pi /login` 改写，
  // 立即失效缓存，让 ReadyChecklist 在本次运行内也能看到认证状态。
  mainWindow.on("focus", () => invalidateAuthCache());
  installWindowOpenHandler(mainWindow);
  installWillNavigateHandler(mainWindow, rendererUrl);

  if (rendererUrl) mainWindow.loadURL(rendererUrl);
  else mainWindow.loadFile(join(__dirname, "../renderer/index.html"));

  autoOpenDevTools(mainWindow);

  mainWindow.on("closed", () => {
    mainWindow = null;
    destroySplashImmediate();
  });

  scheduleSplashRevealTimeout(revealMain);
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
  // 启动期一次性同步预热的 prefs cache 已就绪 (bootRuntime 入口), 把保存的
  // logo 应用到主窗口 (title bar / taskbar) 并推送给 renderer。renderer 也会
  // 在 useLogo() 挂载时再读 prefs 一次, 这里是双保险。
  try {
    const active = getCachedPrefs().clientLogoId;
    runtime.notifyLogoChange(active, mainWindow);
  } catch (err) {
    dbgWarn("boot", "apply startup logo failed", err instanceof Error ? err.message : String(err));
  }
}

// Windows taskbar 用 AUMID 识别应用并缓存图标。设置稳定 AUMID 之后,
// 运行时 BrowserWindow.setIcon 才会被 taskbar 接受, 否则系统会一直用
// 打包时的 .ico (electron-builder 烘焙的那张)。
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
      setImmediate(() => void bootApp());
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    revealMain();
  });

  Menu.setApplicationMenu(null);
  registerLogoProtocolHandler();

  createSplash(appIcon);
  setImmediate(() => void bootApp());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createSplash(appIcon);
      setImmediate(() => void bootApp());
    }
  });
});

app.on("window-all-closed", async () => {
  destroySplashImmediate();
  await runtime?.shutdownRuntime();
  if (process.platform !== "darwin") app.quit();
});
