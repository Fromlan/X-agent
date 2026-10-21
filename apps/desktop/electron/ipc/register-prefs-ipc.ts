/**
 * Prefs IPC (主题 E #62 拆分, 2026-09-08).
 *
 * - getPrefs: 同步读 cache (bootRuntime 已预热)
 * - setPrefs: typebox schema 校验, 工具白名单过滤, patch 写入后:
 *   - 若改了 disabledSkills, 通知 SessionHost reloadResources
 *
 * 关键设计: prefs 不再是 module-singleton, 而是通过 `PrefsIpcDeps` 注入.
 * 单元测试可以传入 mock 实现, 不会污染主进程 cache.
 */
import { type IpcMain } from "electron";
import { Value } from "typebox/value";
import { ALL_TOGGLEABLE_TOOLS, ClientPrefs, ClientPrefsPatchSchema } from "../../shared/ipc";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { handle } from "./register-ipc";

export type PrefsIpcDeps = {
  loadPrefs: () => ClientPrefs;
  patchPrefs: (patch: Partial<ClientPrefs>) => Promise<ClientPrefs>;
  applyTools: (tools: string[]) => Promise<{ ok: boolean; error?: string }>;
  reloadResources: () => Promise<unknown>;
  onGodotPreferencesChanged?: () => void;
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
    if (typedPatch.tools) {
      const allowed = new Set<string>(ALL_TOGGLEABLE_TOOLS as readonly string[]);
      const applied = await deps.applyTools(typedPatch.tools.filter((t) => allowed.has(t)));
      if (!applied.ok) throw new Error(applied.error ?? "工具设置未能保存并应用");
      const { tools: _drop, ...rest } = typedPatch;
      if (Object.keys(rest).length === 0) return await deps.loadPrefs();
      const next = await deps.patchPrefs(rest);
      if (rest.godotAutoConnect !== undefined) deps.onGodotPreferencesChanged?.();
      if (rest.disabledSkills !== undefined) {
        await deps.reloadResources();
      }
      return next;
    }
    const next = await deps.patchPrefs(typedPatch);
    if (typedPatch.godotAutoConnect !== undefined) deps.onGodotPreferencesChanged?.();
    if (typedPatch.disabledSkills !== undefined) {
      await deps.reloadResources();
    }
    return next;
  });
}
