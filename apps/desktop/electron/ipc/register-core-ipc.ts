/**
 * Core / lifecycle / 启动期 IPC (主题 E #62 拆分, 2026-09-08).
 *
 * - openProject: 弹文件夹对话框 → host.openProject
 * - appReady: renderer 确认已就绪, 触发 revealMain
 * - openExternalUrl / openPiLogin: 跳转 / Pi 登录引导
 * - getStartupReport / getPrefsRecoveryNotice: 启动期失败摘要 + prefs
 *   损坏备份提示
 */
import { app, dialog, type BrowserWindow, type IpcMain } from "electron";
import { diagnosticSnapshot, normalizeRendererFailure, recordDiagnostic } from "../boot/diagnostics";
import { writeJsonAtomic } from "../agent/lib/atomic-write";
import type { SessionHost } from "../agent/session-host";
import { openPiLogin } from "../agent/pi-cli";
import type { PrefsRecoveryNotice } from "../agent/prefs";
import type { StartupIssue } from "../boot/startup-issues";
import { coerceSessionType } from "../../shared/session-type";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { handle } from "./register-ipc";

export type CoreIpcDeps = {
  sessionHost: SessionHost;
  openExternalHttpUrl: (
    url: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  revealMainWindow: () => void;
  /** Consume & clear pending prefs recovery notice (queue semantics). */
  consumePrefsRecoveryNotice: () => PrefsRecoveryNotice | null;
  /** Consume & clear pending startup issues (queue semantics). */
  consumeStartupIssues: () => StartupIssue[];
  getGodotClientCount: () => number;
};

export function registerCoreIpc(ipcMain: IpcMain, deps: CoreIpcDeps): void {
  const { sessionHost: host } = deps;
  /** Produce privacy-minimized support metadata without including cwd or transcript text. */
  const snapshot = () => diagnosticSnapshot(app.getVersion(), {
    status: host.getStatus().status, mode: host.getSessionMode().mode,
    sessionActive: !!host.getStatus().cwd, godotClients: deps.getGodotClientCount(),
  });
  let rendererRecovering = false;
  handle(ipcMain, IPC_CHANNELS.reportRendererFailure, async (_event, value) => {
    const failure = normalizeRendererFailure(value);
    recordDiagnostic(failure.kind === "rejection" ? "renderer-rejection" : "renderer-error", failure.reason);
    if (failure.kind === "rejection" && (failure.reason === "network" || failure.reason === "aborted")) {
      host.reportRequestFailure(failure.reason);
      return { ok: true as const };
    }
    if (!rendererRecovering) {
      rendererRecovering = true;
      try { await (await import("../app-runtime")).stopTurnForRecovery(); }
      catch { recordDiagnostic("main-rejection", "unknown"); }
      void dialog.showMessageBox({ type: "error", title: "界面发生未处理异常", message: "已停止当前回合。请重新启动以恢复已保存的会话。诊断只保存错误类型，不包含异常正文。", buttons: ["重新启动", "退出"], defaultId: 0, cancelId: 1 }).then((choice) => {
        if (choice.response === 0) app.relaunch();
        app.quit();
      }).catch(() => app.exit(1));
    }
    return { ok: true as const };
  });
  handle(ipcMain, IPC_CHANNELS.getDiagnosticSnapshot, async () => snapshot());
  handle(ipcMain, IPC_CHANNELS.exportDiagnosticBundle, async () => {
    const result = await dialog.showSaveDialog({ title: "导出本地诊断包", defaultPath: "x-agent-diagnostics.json", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await writeJsonAtomic(result.filePath, snapshot());
    return { ok: true, path: result.filePath };
  });

  handle(
    ipcMain,
    IPC_CHANNELS.openProject,
    async (_e, path?: string, mode?: "continue" | "new", sessionType?: unknown) => {
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
            thinkingLevel: "off" as const,
            sessionType: "code" as const,
            error: "已取消",
          };
        }
        projectPath = result.filePaths[0];
      }
      return host.openProject(
        projectPath,
        mode === "new" ? "new" : "continue",
        coerceSessionType(sessionType),
      );
    },
  );

  handle(ipcMain, IPC_CHANNELS.appReady, async () => {
    deps.revealMainWindow();
    return { ok: true as const };
  });

  handle(ipcMain, IPC_CHANNELS.openExternalUrl, async (_e, url: string) =>
    deps.openExternalHttpUrl(typeof url === "string" ? url : ""),
  );

  handle(ipcMain, IPC_CHANNELS.openPiLogin, async () => openPiLogin());

  handle(ipcMain, IPC_CHANNELS.getPrefsRecoveryNotice, async () =>
    deps.consumePrefsRecoveryNotice(),
  );
  // 1.3 防御: 暴露启动期失败摘要, 让 renderer 在 ReadyChecklist 里提示
  // 用户「上次启动有 X 失败」而不是默默成功.
  handle(ipcMain, IPC_CHANNELS.getStartupReport, async () =>
    deps.consumeStartupIssues(),
  );
}
