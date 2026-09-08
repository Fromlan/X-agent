/**
 * Composition root (主题 E #62 收口, 2026-09-08).
 *
 * 原 413 行 god function 拆为:
 * - `electron/boot/main-window.ts` 主窗口构造
 * - `electron/boot/app-init.ts` 启动期 wiring
 * - `electron/boot/prefs-recovery-notice.ts` 损坏 prefs 提示
 * - `electron/boot/startup-issues.ts` 启动期失败摘要
 * - `electron/ipc/register-*-ipc.ts` 8 类 IPC handler
 * - `electron/ipc/register-ipc-handlers.ts` 一行接线
 *
 * 本文件只剩 SessionHost / GodotRpcBridge / AppAutoUpdater 三件主对象的
 * 构造 + 异步启动流程, 全部走显式 deps 而非 module-singleton.
 */
import type { BrowserWindow } from "electron";
import { ipcMain } from "electron";
import { ensureBuiltinDesignSkillsInstalledSync } from "./agent/builtin-skills-installer";
import { GodotRpcBridge } from "./agent/godot-rpc-bridge";
import {
  getCachedPrefs,
  loadPrefs,
  loadPrefsWithRecovery,
  patchPrefs,
} from "./agent/prefs";
import type { ClientPrefs } from "../shared/ipc";
import { SessionHost } from "./agent/session-host";
import { recoverAllDisabledNestedGit } from "./agent/shadow-git";
import { AppAutoUpdater } from "./agent/auto-updater";
import { ensureGodotPiPackageInstalled } from "./agent/package-manager";
import { notifyLogoChange } from "./agent/agent-logos";
import { cleanupOrphanTmpFiles } from "./agent/lib/orphan-cleanup";
import { dbgLog, dbgWarn } from "../shared/debug-log";
import {
  applyStartupPrefsLoad,
  consumePrefsRecoveryNotice,
} from "./boot/prefs-recovery-notice";
import {
  consumeStartupIssues,
  pushStartupIssue,
} from "./boot/startup-issues";
import { registerIpcHandlers } from "./ipc/register-ipc-handlers";

export type RuntimeHooks = {
  getMainWindow: () => BrowserWindow | null;
  revealMainWindow: () => void;
  openExternalHttpUrl: (
    url: string,
  ) => Promise<{ ok: boolean; error?: string }>;
};

let godotRpc: GodotRpcBridge | null = null;
let sessionHost: SessionHost | null = null;
let updater: AppAutoUpdater | null = null;

/** Prefs port (issue #62 主题 E-3 显式注入). 单元测试可 mock. */
const prefsPort = {
  loadPrefs: () => loadPrefs(),
  patchPrefs: (patch: Partial<ClientPrefs>) => patchPrefs(patch),
  getCachedPrefs: () => getCachedPrefs(),
};

/** Re-export so main.ts's `runtime.notifyLogoChange(...)` call site still
 *  works after C-405 moved the implementation to agent-logos.ts. */
export { notifyLogoChange };

/** Call only after splash is visible. */
export function bootRuntime(hooks: RuntimeHooks): void {
  applyStartupPrefsLoad(loadPrefsWithRecovery());
  godotRpc = new GodotRpcBridge();
  sessionHost = new SessionHost(hooks.getMainWindow, godotRpc);
  updater = new AppAutoUpdater(hooks.getMainWindow);
  registerIpcHandlers({
    ipcMain,
    sessionHost,
    godotRpc,
    updater,
    getMainWindow: hooks.getMainWindow,
    revealMainWindow: hooks.revealMainWindow,
    openExternalHttpUrl: hooks.openExternalHttpUrl,
    loadPrefs: prefsPort.loadPrefs,
    patchPrefs: prefsPort.patchPrefs,
    getCachedPrefs: prefsPort.getCachedPrefs,
    notifyLogoChange,
    consumePrefsRecoveryNotice,
    consumeStartupIssues,
  });
  updater.init();
  // 同步预热 builtin design skills (≤50ms 启动开销, design session 启动时
  // ~/.pi/agent/skills/design-*/SKILL.md 已在位, Pi DefaultResourceLoader 立即发现).
  // 失败由 installer 内部静默吞, 这里不再 try/catch.
  ensureBuiltinDesignSkillsInstalledSync();

  void (async () => {
    try {
      // B8: 启动兜底 — 恢复上次崩溃残留的改名嵌套 .git.
      recoverAllDisabledNestedGit();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushStartupIssue({ stage: "shadow_recover", message });
      dbgWarn("boot", "shadow_recover failed", message);
    }
    try {
      // 1.3 清理: 上会话残留的 .tmp / failed-* / 久未动 godot-rpc endpoint.
      const orphanStats = cleanupOrphanTmpFiles();
      if (
        orphanStats.atomicTmp > 0 ||
        orphanStats.bashProbes > 0 ||
        orphanStats.oldEndpoints > 0
      ) {
        dbgLog("boot", "orphan cleanup", orphanStats);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dbgWarn("boot", "orphan cleanup failed", message);
    }
    try {
      const bridgeStatus = await godotRpc.start();
      if (!bridgeStatus.running && bridgeStatus.error) {
        pushStartupIssue({ stage: "godot_rpc", message: bridgeStatus.error });
        dbgWarn("boot", "godot_rpc start failed", bridgeStatus.error);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushStartupIssue({ stage: "godot_rpc", message });
      dbgWarn("boot", "godot_rpc start threw", message);
    }
    try {
      const ensured = await ensureGodotPiPackageInstalled();
      if (ensured.attempted && ensured.installed) {
        await sessionHost.reloadResources();
      }
      if (ensured.attempted && !ensured.installed) {
        const msg = ensured.error ?? "内置 Package 安装失败";
        pushStartupIssue({ stage: "godot_pi_install", message: msg });
        dbgWarn("boot", "godot_pi_install failed", msg);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushStartupIssue({ stage: "godot_pi_install", message });
      dbgWarn("boot", "godot_pi_install threw", message);
    }
  })();
}

export async function shutdownRuntime(): Promise<void> {
  await godotRpc?.stop();
  await sessionHost?.dispose();
}
