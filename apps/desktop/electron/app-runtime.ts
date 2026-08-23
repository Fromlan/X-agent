import { dialog, ipcMain, shell, type BrowserWindow } from "electron";
import { Value } from "typebox/value";
import { applyBashShellPath, checkBash, findSuggestedBash } from "./agent/bash-check";
import { probeBashLiveness } from "./agent/bash-liveness";
import { checkAuth } from "./agent/auth-check";
import { checkGit } from "./agent/git-exec";
import { checkPiCli, installPiCli, openPiLogin } from "./agent/pi-cli";
import { loadPrefs, loadPrefsWithRecovery, patchPrefs } from "./agent/prefs";
import type { PrefsLoadResult } from "./agent/prefs";
import { GodotRpcBridge } from "./agent/godot-rpc-bridge";
import { SessionHost } from "./agent/session-host";
import {
  listProjectDir,
  readProjectFile,
  revealProjectPath,
} from "./agent/project-fs";
import { AppAutoUpdater } from "./agent/auto-updater";
import { recoverAllDisabledNestedGit } from "./agent/shadow-git";
import {
  ensureGodotPiPackageInstalled,
  installGodotPiPackage,
  installPackage,
  listInstalledPackages,
  uninstallPackage,
} from "./agent/package-manager";
import {
  createPlugin,
  deletePlugin,
  listPlugins,
  readPlugin,
  revealPlugin,
  writePlugin,
} from "./agent/plugin-host";
import { clearUsageSummary, getUsageSummary } from "./agent/usage-store";
import { getSecretCodecStatus } from "./agent/secret-codec";
import {
  ClientPrefs,
  ClientPrefsPatchSchema,
  PluginCreateInput,
  PrefsRecoveryNotice,
} from "../shared/ipc";
import { ALL_TOGGLEABLE_TOOLS } from "../shared/ipc";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import { registerWorkspaceIpc } from "./ipc/register-workspace-ipc";
import { registerTurnIpc } from "./ipc/register-turn-ipc";
import { registerPlanIpc } from "./ipc/register-plan-ipc";
import { registerSessionConfigIpc } from "./ipc/register-session-config-ipc";
import { registerStageIpc } from "./ipc/register-stage-ipc";
import { registerProviderIpc } from "./ipc/register-provider-ipc";
import { registerGodotIpc } from "./ipc/register-godot-ipc";
import { registerUpdateIpc } from "./ipc/register-update-ipc";
import {
  configureIpcSenderGuard,
  handle,
} from "./ipc/register-ipc";
import { dbgLog, dbgWarn } from "../shared/debug-log";
import { cleanupOrphanTmpFiles } from "./agent/lib/orphan-cleanup";

export type RuntimeHooks = {
  getMainWindow: () => BrowserWindow | null;
  revealMainWindow: () => void;
  openExternalHttpUrl: (
    url: string,
  ) => Promise<{ ok: boolean; error?: string }>;
};

let godotRpc: GodotRpcBridge | null = null;
let sessionHost: SessionHost | null = null;
/** Cleared when renderer consumes via getPrefsRecoveryNotice. */
let pendingPrefsRecovery: PrefsRecoveryNotice | null = null;
/** 启动期失败摘要（recover / bridge / package install）。renderer 经 getStartupReport 读取。 */
type StartupIssue = {
  stage: "shadow_recover" | "godot_rpc" | "godot_pi_install";
  message: string;
};
let startupIssues: StartupIssue[] = [];

function pushStartupIssue(issue: StartupIssue): void {
  startupIssues.push(issue);
  // 限制条数，避免磁盘写错误 / 端口冲突等反复堆积。
  if (startupIssues.length > 32) {
    startupIssues = startupIssues.slice(-32);
  }
}

function consumeStartupIssues(): StartupIssue[] {
  const out = startupIssues;
  startupIssues = [];
  return out;
}

function consumePrefsRecoveryNotice(): PrefsRecoveryNotice | null {
  const notice = pendingPrefsRecovery;
  pendingPrefsRecovery = null;
  return notice;
}

function applyStartupPrefsLoad(result: PrefsLoadResult): void {
  if (result.ok || !result.recovered) {
    pendingPrefsRecovery = null;
    return;
  }
  pendingPrefsRecovery = {
    backedUp: result.recovered.backedUp,
    backupPath: result.recovered.backupPath,
    error: result.recovered.error,
  };
  // File was renamed away on successful backup — seed defaults so later loads work.
  if (result.recovered.backedUp) {
    patchPrefs({});
  }
}

function registerIpc(
  host: SessionHost,
  rpc: GodotRpcBridge,
  updater: AppAutoUpdater,
  hooks: RuntimeHooks,
): void {
  // 统一 IPC sender 守卫：仅主窗口 webContents 可调用任何 channel。
  configureIpcSenderGuard(
    () => hooks.getMainWindow(),
    process.env.ELECTRON_RENDERER_URL ?? null,
  );
  const cwdOf = () => host.getStatus().cwd;

  handle(ipcMain, 
    IPC_CHANNELS.openProject,
    async (_e, path?: string, mode?: "continue" | "new") => {
    let projectPath =
      typeof path === "string" && path.trim() ? path.trim() : undefined;
    if (!projectPath) {
      const result = await dialog.showOpenDialog({
        title: "打开项目文件夹",
        properties: ["openDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return {
          ok: false,
          cwd: "",
          sessionId: "",
          model: null,
          thinkingLevel: "off",
          error: "已取消",
        };
      }
      projectPath = result.filePaths[0];
    }
    return host.openProject(projectPath, mode === "new" ? "new" : "continue");
  },
  );

  registerWorkspaceIpc(ipcMain, host);
  registerTurnIpc(ipcMain, host);
  registerPlanIpc(ipcMain, host);
  registerSessionConfigIpc(ipcMain, host);
  registerStageIpc(ipcMain, host);

  handle(ipcMain, IPC_CHANNELS.getPrefs, async () => loadPrefs());
  handle(ipcMain, IPC_CHANNELS.setPrefs, async (_e, patch: unknown) => {
    // S4: 运行时 schema 校验。拒绝任何未声明字段(如 `language` / `theme` legacy),
    // 拒绝类型越界,挡下被攻陷 renderer 写入任意路径或布尔值。
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new Error("prefs patch 必须是对象");
    }
    if (!Value.Check(ClientPrefsPatchSchema, patch)) {
      const errors = Value.Errors(ClientPrefsPatchSchema, patch);
      throw new Error(
        `prefs patch 校验失败:${errors
          .slice(0, 3)
          .map((e) => `${e.instancePath || "/"}${e.message ? `: ${e.message}` : ""}`)
          .join("; ")}`,
      );
    }
    const typedPatch = patch as Partial<ClientPrefs>;
    if (typedPatch.tools) {
      const allowed = new Set<string>(ALL_TOGGLEABLE_TOOLS as readonly string[]);
      await host.applyTools(typedPatch.tools.filter((t) => allowed.has(t)));
      const { tools: _drop, ...rest } = typedPatch;
      if (Object.keys(rest).length === 0) return await loadPrefs();
      const next = await patchPrefs(rest);
      if (rest.disabledSkills !== undefined) {
        await host.reloadResources();
      }
      return next;
    }
    const next = await patchPrefs(typedPatch);
    if (typedPatch.disabledSkills !== undefined) {
      await host.reloadResources();
    }
    return next;
  });
  handle(ipcMain, IPC_CHANNELS.checkBash, async () => await checkBash());
  handle(ipcMain, IPC_CHANNELS.checkBashLiveness, async () =>
    await probeBashLiveness({ findSuggested: findSuggestedBash }),
  );
  handle(ipcMain, IPC_CHANNELS.applyBashShellPath, async (_e, shellPath?: string) =>
    await applyBashShellPath(shellPath),
  );
  handle(ipcMain, IPC_CHANNELS.pickBashShell, async () => {
    const current = await checkBash();
    const result = await dialog.showOpenDialog({
      title: "选择 bash 可执行文件",
      defaultPath: current.shellPath ?? current.suggestedShellPath ?? undefined,
      properties: ["openFile"],
      filters:
        process.platform === "win32"
          ? [
              { name: "bash", extensions: ["exe"] },
              { name: "所有文件", extensions: ["*"] },
            ]
          : [{ name: "bash", extensions: ["*"] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    return { ok: true, path: result.filePaths[0]! };
  });
  handle(ipcMain, IPC_CHANNELS.checkAuth, async () => await checkAuth());
  handle(ipcMain, IPC_CHANNELS.checkGit, async () => checkGit());
  handle(ipcMain, IPC_CHANNELS.checkPiCli, async () => checkPiCli());
  handle(ipcMain, IPC_CHANNELS.installPiCli, async () => installPiCli());
  handle(ipcMain, IPC_CHANNELS.listProjectDir, async (_e, relPath?: string) =>
    listProjectDir(cwdOf() ?? "", relPath ?? ""),
  );
  handle(ipcMain, IPC_CHANNELS.readProjectFile, async (_e, relPath: string) =>
    readProjectFile(cwdOf() ?? "", relPath),
  );
  handle(ipcMain, IPC_CHANNELS.revealInFolder, async (_e, relPath: string) => {
    const result = revealProjectPath(cwdOf() ?? "", relPath);
    if (result.ok && result.path) {
      shell.showItemInFolder(result.path);
    }
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  });

  registerGodotIpc(ipcMain, host, rpc);
  registerProviderIpc(ipcMain, host);

  handle(ipcMain, IPC_CHANNELS.listPlugins, async (_e, cwd?: string | null) =>
    listPlugins(cwd ?? cwdOf()),
  );
  handle(ipcMain, IPC_CHANNELS.listSessionSlashItems, async () =>
    host.listSessionSlashItems(),
  );
  handle(ipcMain, IPC_CHANNELS.readPlugin, async (_e, path: string) =>
    readPlugin(path, cwdOf()),
  );
  handle(ipcMain, IPC_CHANNELS.writePlugin, async (_e, path: string, content: string) => {
    const result = writePlugin(path, content, cwdOf());
    if (result.ok) await host.reloadResources();
    return result;
  });
  handle(ipcMain, IPC_CHANNELS.createPlugin, async (_e, input: PluginCreateInput) => {
    const result = createPlugin({ ...input, cwd: input.cwd ?? cwdOf() });
    if (result.ok) await host.reloadResources();
    return result;
  });
  handle(ipcMain, IPC_CHANNELS.deletePlugin, async (_e, path: string) => {
    const result = deletePlugin(path, cwdOf());
    if (result.ok) await host.reloadResources();
    return result;
  });
  handle(ipcMain, IPC_CHANNELS.revealPlugin, async (_e, path: string) => {
    const result = revealPlugin(path, cwdOf());
    if (result.ok && result.path) shell.showItemInFolder(result.path);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  });

  handle(ipcMain, IPC_CHANNELS.listInstalledPackages, async () =>
    listInstalledPackages(),
  );
  handle(ipcMain, IPC_CHANNELS.installPackage, async (_e, source: string) => {
    const result = await installPackage(source);
    if (result.ok) await host.reloadResources();
    return result;
  });
  handle(ipcMain, IPC_CHANNELS.uninstallPackage, async (_e, source: string) => {
    const result = await uninstallPackage(source);
    if (result.ok) await host.reloadResources();
    return result;
  });
  handle(ipcMain, IPC_CHANNELS.installGodotPiPackage, async () => {
    const result = await installGodotPiPackage();
    if (result.ok) await host.reloadResources();
    return result;
  });
  handle(ipcMain, IPC_CHANNELS.openPiLogin, async () => openPiLogin());
  handle(ipcMain, IPC_CHANNELS.openExternalUrl, async (_e, url: string) =>
    hooks.openExternalHttpUrl(typeof url === "string" ? url : ""),
  );
  registerUpdateIpc(ipcMain, updater);
  handle(ipcMain, IPC_CHANNELS.getPrefsRecoveryNotice, async () =>
    consumePrefsRecoveryNotice(),
  );
  // 1.3 防御：暴露启动期失败摘要，让 renderer 在 ReadyChecklist 里提示
  // 用户「上次启动有 X 失败」而不是默默成功。
  handle(ipcMain, IPC_CHANNELS.getStartupReport, async () =>
    consumeStartupIssues(),
  );
  handle(ipcMain, IPC_CHANNELS.getSecretCodecStatus, async () =>
    getSecretCodecStatus(),
  );
  handle(ipcMain, IPC_CHANNELS.getUsageSummary, async (_e, options?: { days?: number }) =>
    await getUsageSummary(options),
  );
  handle(ipcMain, IPC_CHANNELS.clearUsageSummary, async () => await clearUsageSummary());
  handle(ipcMain, IPC_CHANNELS.appReady, async () => {
    hooks.revealMainWindow();
    return { ok: true as const };
  });
}

/** Call only after splash is visible. */
export function bootRuntime(hooks: RuntimeHooks): void {
  applyStartupPrefsLoad(loadPrefsWithRecovery());
  godotRpc = new GodotRpcBridge();
  sessionHost = new SessionHost(hooks.getMainWindow, godotRpc);
  const updater = new AppAutoUpdater(hooks.getMainWindow);
  registerIpc(sessionHost, godotRpc, updater, hooks);
  updater.init();

  void (async () => {
    try {
      // B8: 启动兜底 — 恢复上次崩溃残留的改名嵌套 .git。
      recoverAllDisabledNestedGit();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushStartupIssue({ stage: "shadow_recover", message });
      dbgWarn("boot", "shadow_recover failed", message);
    }
    try {
      // 1.3 清理：上会话残留的 .tmp / failed-* / 久未动 godot-rpc endpoint。
      const orphanStats = cleanupOrphanTmpFiles();
      if (
        orphanStats.atomicTmp > 0 ||
        orphanStats.bashProbes > 0 ||
        orphanStats.oldEndpoints > 0
      ) {
        dbgLog(
          "boot",
          "orphan cleanup",
          orphanStats,
        );
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
