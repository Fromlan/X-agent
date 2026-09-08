/**
 * Usage + Client logo IPC (主题 E #62 拆分, 2026-09-08).
 *
 * - getUsageSummary / clearUsageSummary: 累计 token / cost 统计
 * - logoListPresets / logoUploadCustom / logoClearCustom: client logo 资产
 *   (preset + custom + active), 走 agent-logos; 上传/删除后通过
 *   notifyLogoChange 把 active 状态广播给 renderer.
 */
import { dialog, type BrowserWindow, type IpcMain } from "electron";
import {
  deleteCustomLogo,
  listLogos,
  notifyLogoChange,
  saveCustomLogo,
} from "../agent/agent-logos";
import { patchPrefs } from "../agent/prefs";
import { clearUsageSummary, getUsageSummary } from "../agent/usage-store";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { handle } from "./register-ipc";

export type AssetsIpcDeps = {
  getCachedPrefs: () => { clientLogoId: string };
  getMainWindow: () => BrowserWindow | null;
};

export function registerAssetsIpc(
  ipcMain: IpcMain,
  deps: AssetsIpcDeps,
): void {
  // ===== usage summary =====
  handle(ipcMain, IPC_CHANNELS.getUsageSummary, async (_e, options?: { days?: number }) =>
    await getUsageSummary(options),
  );
  handle(ipcMain, IPC_CHANNELS.clearUsageSummary, async () => await clearUsageSummary());

  // ===== client logo assets =====
  handle(ipcMain, IPC_CHANNELS.logoListPresets, async () => {
    const active = deps.getCachedPrefs().clientLogoId;
    return listLogos(active);
  });
  handle(ipcMain, IPC_CHANNELS.logoUploadCustom, async () => {
    // Native picker keeps the renderer sandbox-pure; we still validate
    // (size / format / dim) in `saveCustomLogo` before accepting.
    const result = await dialog.showOpenDialog({
      title: "选择自定义 logo",
      properties: ["openFile"],
      filters: [
        { name: "图片", extensions: ["png", "jpg", "jpeg"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false as const, error: "已取消", code: "INVALID_FILE" as const };
    }
    return saveCustomLogo(result.filePaths[0]!);
  });
  handle(ipcMain, IPC_CHANNELS.logoClearCustom, async (_e, customId: unknown) => {
    if (typeof customId !== "string" || !customId) {
      return { ok: false, error: "无效 id" };
    }
    const wasActive = deps.getCachedPrefs().clientLogoId === customId;
    const result = deleteCustomLogo(customId);
    let revertedActive = false;
    if (wasActive && result.ok) {
      // Revert to default so the next render / IPC pull does not point at a
      // deleted file. patchPrefs will clamp + emit logo:changed via us below.
      await patchPrefs({ clientLogoId: "default" });
      revertedActive = true;
    } else if (!result.ok) {
      return { ok: false, error: result.error ?? "删除失败" };
    }
    if (revertedActive) {
      // Reuse the prefs-cached active id (just patched to "default") for the broadcast.
      const next = deps.getCachedPrefs().clientLogoId;
      notifyLogoChange(next, deps.getMainWindow());
    }
    return { ok: true, revertedActive };
  });
}
