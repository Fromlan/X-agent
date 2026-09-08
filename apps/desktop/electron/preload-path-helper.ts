/**
 * preload 辅助: 拖放文件路径桥 (issue #60 主题 D C-304, 2026-08-31).
 *
 * 之前 `electron/preload.ts:198-205` 8 行直接 contextBridge.exposeInMainWorld
 * "xAgentPath", 跟 "xAgent" 一起占 2 个 global. 现在抽到这里, preload 只
 * 做"暴露"动作 (1 行), helper 集中所有 sandbox 兼容的 browser API.
 *
 * 为什么需要这个桥: Electron 32+ 不再给 File 注入 `.path` (安全: 防跨
 * origin 拖放时泄文件路径), renderer 进程要拿绝对路径 (用于 @<path>
 * 引用 / cwd-sandbox resolve) 必须走 webUtils.getPathForFile. sandbox
 * renderer 不能直接 import 'electron', 所以 preload 经 contextBridge 暴露.
 *
 * 抽离理由 (C-304):
 *   - preload.ts 只剩薄壳, 1 个 global (xAgent) + 1 行 mount 调用
 *   - 后续要加其他 sandbox-only bridge (例如 dialog.showMessageBox) 都
 *     在这个文件加, 不污染 preload 主体
 *   - 单元测试可以 mock webUtils.getPathForFile, 不必走真实 contextBridge
 *
 * 类型: 渲染端 `window.xAgentPath` 类型在 `src/vite-env.d.ts` (`declare global`),
 * preload 不重复声明 — 单一类型源, 改 getForFile 签名只动一处.
 */
import { contextBridge, webUtils } from "electron";

/** Public surface exposed on `window.xAgentPath`. */
export interface XAgentPathBridge {
  getForFile: (file: File) => string;
}

export const xAgentPathBridge: XAgentPathBridge = {
  getForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      // webUtils 在某些受限环境会抛 (例如非 file 协议的 pseudo-file);
      // 失败时返回空串, 渲染端走 fallback (user paste 路径手动输入).
      return "";
    }
  },
};

/**
 * Mount the bridge on `window.xAgentPath`. Called once from preload.
 * Splitting the mount from the surface keeps the helper itself pure
 * (no side-effects at import time) — easy to unit-test in isolation.
 */
export function mountXAgentPath(): void {
  contextBridge.exposeInMainWorld("xAgentPath", xAgentPathBridge);
}
