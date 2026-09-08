import type { Dispatch, SetStateAction } from "react";

/**
 * `withBusyLifecycle` —— Issue #61 主题 F C-203 (2026-08-31).
 *
 * 6 个 workspace 方法 (openProject / newSession / resumeSession /
 * deleteSession / deleteProjectSessions / closeWorkspace) 共享的
 * busy 生命周期:
 *
 *   setBusy(true) → setError(null) → fn() → finally setBusy(false)
 *
 * 把 3 行 boilerplate 合一, 6 个方法各自只剩业务逻辑 (IPC call + 状态更新).
 *
 * 提取为独立 module 以便 (1) 单元测试 (纯 async fn, 无 React 依赖),
 * (2) 其他 hook (e.g. Godot 工具 / Settings) 后续可复用同样模板.
 */
export async function withBusyLifecycle(
  setBusy: Dispatch<SetStateAction<boolean>>,
  setError: Dispatch<SetStateAction<string | null>>,
  fn: () => Promise<void>,
): Promise<void> {
  setBusy(true);
  setError(null);
  try {
    await fn();
  } finally {
    setBusy(false);
  }
}
