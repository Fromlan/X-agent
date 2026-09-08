/**
 * Prefs IPC (主题 E #62 拆分, 2026-09-08).
 *
 * - getPrefs: 同步读 cache (bootRuntime 已预热)
 * - setPrefs: typebox schema 校验, 工具白名单过滤, patch 写入后:
 *   - 若改了 disabledSkills, 通知 SessionHost reloadResources
 *   - 若改了 clientLogoId, 推 logo:changed 事件 + title bar 图标
 *
 * 关键设计: prefs 不再是 module-singleton, 而是通过 `PrefsIpcDeps` 注入.
 * 单元测试可以传入 mock 实现, 不会污染主进程 cache.
 */
import { type BrowserWindow, type IpcMain } from "electron";
import { Value } from "typebox/value";
import { ALL_TOGGLEABLE_TOOLS, ClientPrefs, ClientPrefsPatchSchema } from "../../shared/ipc";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { handle } from "./register-ipc";

export type PrefsIpcDeps = {
  loadPrefs: () => ClientPrefs;
  patchPrefs: (patch: Partial<ClientPrefs>) => Promise<ClientPrefs>;
  getCachedPrefs: () => ClientPrefs;
  applyTools: (tools: string[]) => Promise<unknown>;
  reloadResources: () => Promise<unknown>;
  notifyLogoChange: (id: string, win: BrowserWindow | null) => void;
  getMainWindow: () => BrowserWindow | null;
};

export function registerPrefsIpc(ipcMain: IpcMain, deps: PrefsIpcDeps): void {
  handle(ipcMain, IPC_CHANNELS.getPrefs, async () => deps.loadPrefs());

  handle(ipcMain, IPC_CHANNELS.setPrefs, async (_e, patch: unknown) => {
    // S4: 运行时 schema 校验. 拒绝任何未声明字段(如 `language` / `theme` legacy),
    // 拒绝类型越界, 挡下被攻陷 renderer 写入任意路径或布尔值.
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
    const logoTouched = typedPatch.clientLogoId !== undefined;
    const prevLogoId = logoTouched ? deps.getCachedPrefs().clientLogoId : null;
    if (typedPatch.tools) {
      const allowed = new Set<string>(ALL_TOGGLEABLE_TOOLS as readonly string[]);
      await deps.applyTools(typedPatch.tools.filter((t) => allowed.has(t)));
      const { tools: _drop, ...rest } = typedPatch;
      if (Object.keys(rest).length === 0) return await deps.loadPrefs();
      const next = await deps.patchPrefs(rest);
      if (rest.disabledSkills !== undefined) {
        await deps.reloadResources();
      }
      if (logoTouched && next.clientLogoId !== prevLogoId) {
        deps.notifyLogoChange(next.clientLogoId, deps.getMainWindow());
      }
      return next;
    }
    const next = await deps.patchPrefs(typedPatch);
    if (typedPatch.disabledSkills !== undefined) {
      await deps.reloadResources();
    }
    if (logoTouched && next.clientLogoId !== prevLogoId) {
      deps.notifyLogoChange(next.clientLogoId, deps.getMainWindow());
    }
    return next;
  });
}
