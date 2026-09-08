/**
 * Prefs 损坏恢复提示 (主题 E #62 拆分, 2026-09-08).
 *
 * 启动期 `loadPrefsWithRecovery` 解析失败时, 把损坏文件备份 + 记一条
 * PrefsRecoveryNotice, renderer 通过 IPC `getPrefsRecoveryNotice` 拉取.
 * 一次性的 queue 语义, 取走后清空.
 */
import type {
  PrefsLoadResult,
  PrefsRecoveryNotice,
} from "../agent/prefs";
import { patchPrefs } from "../agent/prefs";

let pending: PrefsRecoveryNotice | null = null;

export function applyStartupPrefsLoad(result: PrefsLoadResult): void {
  if (result.ok || !result.recovered) {
    pending = null;
    return;
  }
  pending = {
    ok: false as const,
    backedUp: result.recovered.backedUp,
    backupPath: result.recovered.backupPath,
    error: result.recovered.error,
  };
  // File was renamed away on successful backup — seed defaults so later loads work.
  if (result.recovered.backedUp) {
    void patchPrefs({});
  }
}

export function consumePrefsRecoveryNotice(): PrefsRecoveryNotice | null {
  const out = pending;
  pending = null;
  return out;
}

/** Test-only. */
export function _resetPrefsRecoveryForTests(): void {
  pending = null;
}
