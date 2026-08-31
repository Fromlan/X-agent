/**
 * Splash 窗口生命周期 (主题 E #62 PR-Y7 拆分, 2026-08-31).
 *
 * 启动期淡出 + 销毁: revealMain() 触发 fadeOutSplash → destroySplash → 显示主窗口
 * 超时 fallback: createMain() setTimeout(revealMain, SPLASH_TIMEOUT_MS) 防止 splash 卡死
 */
import { app, BrowserWindow } from "electron";
import { join } from "node:path";

const SPLASH_TIMEOUT_MS = 30_000;
// 淡出动画时长需与 splash.html 中 body.leaving 的 transition 时长保持一致。
const SPLASH_FADE_OUT_MS = 320;

let splashWindow: BrowserWindow | null = null;
let splashTimer: ReturnType<typeof setTimeout> | null = null;

function alive(win: BrowserWindow | null): win is BrowserWindow {
  return !!win && !win.isDestroyed();
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
 * 触发启动页的淡出动画, 等动画结束再真正销毁窗口.
 * 通过 webContents.executeJavaScript 注入 class, 不受页面 CSP 对 inline script 的限制.
 */
async function fadeOutSplash(): Promise<void> {
  const win = splashWindow;
  if (!alive(win)) return;
  try {
    await win.webContents.executeJavaScript(
      "document.body.classList.add('leaving');",
    );
  } catch {
    // 注入失败(页面尚未就绪)时直接销毁, 避免长时间白屏.
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, SPLASH_FADE_OUT_MS));
}

export type RevealDeps = {
  getMainWindow: () => BrowserWindow | null;
};

/**
 * 触发 splash 淡出 + 销毁 + 显示主窗口 (幂等).
 * 配套在 main.ts 的 setTimeout fallback 中调用 (SPLASH_TIMEOUT_MS 兜底).
 */
export function createRevealMain(deps: RevealDeps): () => void {
  let revealed = false;
  return function revealMain(): void {
    if (revealed) return;
    revealed = true;
    // 先淡出再销毁, 避免视觉跳变; 主窗口稍晚一帧再显示, 衔接更自然.
    void fadeOutSplash().finally(() => {
      destroySplash();
      const win = deps.getMainWindow();
      if (alive(win)) {
        win.show();
        win.focus();
      }
    });
  };
}

/** 启动 splash 窗口 (幂等: alive 时不重建). */
export function createSplash(getIcon: () => string | undefined): void {
  if (alive(splashWindow)) return;
  const icon = getIcon();
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
    // 窗口背景设为透明, 由内层 .inner 自绘圆角背景, 保证在 Windows 10 / 11 / 老版本都呈现圆角.
    // backgroundColor 与 transparent 互斥, 这里省略.
    transparent: true,
    autoHideMenuBar: true,
    skipTaskbar: true,
    hasShadow: false,
    // 双保险: Win11 22H2+ 也尝试走 DWM 原生圆角; 低版本系统不生效也无所谓, 因 HTML 圆角已生效.
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

/** 调度 revealMain 在 SPLASH_TIMEOUT_MS 后兜底. */
export function scheduleSplashRevealTimeout(reveal: () => void): void {
  if (splashTimer) clearTimeout(splashTimer);
  splashTimer = setTimeout(reveal, SPLASH_TIMEOUT_MS);
}

/** 立即销毁 splash (用于 second-instance / activate 路径或 app quit). */
export function destroySplashImmediate(): void {
  destroySplash();
}
