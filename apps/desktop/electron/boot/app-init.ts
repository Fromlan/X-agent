/**
 * App 启动初始化 (主题 E #62 拆分, 2026-09-08).
 *
 * 从 main.ts 抽离 `bootApp()`: 启动期 splash 显示后,
 * - 第一次跑 `app-runtime.bootRuntime()` (ipc 注册 + SessionHost / GodotRpcBridge
 *   构造), 幂等保护避免 second-instance 重复触发
 * - 同步预热的 prefs cache 已就绪, 把保存的 clientLogoId 应用到主窗口
 *   (title bar / taskbar) 并推送给 renderer
 *
 * 与 main.ts 的"single-instance / second-instance / activate"事件解耦:
 * 任何路径 (splash 启动后 / second-instance / activate) 都可以直接调它.
 */
import type { BrowserWindow } from "electron";
import { dbgWarn } from "../../shared/debug-log";

/** app-runtime 模块的入口 (动态 import, 避免循环依赖). */
export type AppRuntimeModule = typeof import("../app-runtime");

export type BootAppDeps = {
  getMainWindow: () => BrowserWindow | null;
  revealMain: () => void;
  /** app-runtime.openExternalHttpUrl; 启动 IPC hook 之前要就绪. */
  openExternalHttpUrl: (url: string) => Promise<{ ok: boolean; error?: string }>;
  /** 同步读 prefs cache, 给 startup logo 用. */
  getCachedPrefs: () => { clientLogoId: string };
  /** main-window 工厂, 替 main.ts 持有 BrowserWindow ref. */
  createMainWindow: (opts: {
    getMainWindow: () => BrowserWindow | null;
    revealMain: () => void;
    onClosed?: () => void;
  }) => BrowserWindow | null;
  /** mainWindow 引用在外部清空回调 (避免 module-scope 反向依赖). */
  onMainWindowClosed?: () => void;
};

let runtime: AppRuntimeModule | null = null;

export function getRuntime(): AppRuntimeModule | null {
  return runtime;
}

/** 测试 / second-instance 路径需要清空, 防止多次 boot 共享 runtime 状态. */
export function _resetRuntimeForTests(): void {
  runtime = null;
}

/**
 * 幂等的应用启动入口: 第一次调用会 import app-runtime 并 bootRuntime,
 * 之后 createMainWindow + applyStartupLogo.
 *
 * 返回新建的 BrowserWindow (供 main.ts 持有 module-scope ref);
 * runtime 已就绪或重复调用时返回 null, 由 main.ts 自己判断跳过.
 *
 * 设计要点:
 * - runtime 通过动态 import 拿, 避免 main.ts ↔ app-runtime.ts 双向 import
 *   引起的循环依赖 (app-runtime 已经过 #68 主题 J 拆得很薄)
 * - 启动期 logo 同步走 notifyLogoChange (re-exported from agent-logos, see
 *   #68 C-405), 失败仅 dbgWarn; 不阻断主窗口出现.
 */
export async function bootApp(deps: BootAppDeps): Promise<BrowserWindow | null> {
  let created: BrowserWindow | null = null;
  if (!runtime) {
    runtime = await import("../app-runtime");
    runtime.bootRuntime({
      getMainWindow: deps.getMainWindow,
      revealMainWindow: deps.revealMain,
      openExternalHttpUrl: deps.openExternalHttpUrl,
    });
  }
  // 幂等: 已有 mainWindow 时 (second-instance 路径), 不重建.
  if (deps.getMainWindow() && !deps.getMainWindow()!.isDestroyed()) {
    return null;
  }
  created = deps.createMainWindow({
    getMainWindow: deps.getMainWindow,
    revealMain: deps.revealMain,
    onClosed: deps.onMainWindowClosed,
  });
  // 启动期一次性同步预热的 prefs cache 已就绪 (bootRuntime 入口), 把保存的
  // logo 应用到主窗口 (title bar / taskbar) 并推送给 renderer. renderer 也会
  // 在 useLogo() 挂载时再读 prefs 一次, 这里是双保险.
  try {
    const active = deps.getCachedPrefs().clientLogoId;
    runtime.notifyLogoChange(active, deps.getMainWindow());
  } catch (err) {
    dbgWarn(
      "boot",
      "apply startup logo failed",
      err instanceof Error ? err.message : String(err),
    );
  }
  return created;
}
