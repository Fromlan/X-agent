/**
 * Provider Activate — write Pi files + prefs, then apply runtime, with rollback.
 *
 * **唯一外部消费方**: `electron/ipc/register-provider-ipc.ts` 中 `IPC_CHANNELS.activateProviderAndApply`。
 * 该 handler 在 `electron/agent/provider-store.ts` 路径下与 `activateProviderProfile` 协作,
 * 是 v0.3.4 之前"启用供应商"的兼容事务;语义保留,新代码优先走 `register-provider-ipc` 直接组合。
 */
import type { ProviderActivateResult } from "../../shared/ipc";
import { getCachedPrefs, patchPrefs } from "./prefs";
import { activateProviderProfile } from "./provider-pi-sync";
import type { ProviderPaths } from "./provider-persist";

export type ApplyActivatedProvider = (
  provider: string,
  modelId: string,
) => Promise<{ ok: boolean; error?: string }>;

/**
 * Disk activate + runtime apply as one transaction.
 * On apply failure, restores previous prefs provider/model.
 */
export async function activateProviderAndApply(
  id: string,
  applyRuntime: ApplyActivatedProvider,
  paths?: ProviderPaths,
): Promise<ProviderActivateResult> {
  const prevPrefs = getCachedPrefs();
  const result = await activateProviderProfile(id, paths);
  if (!result.ok || !result.provider || !result.model) return result;

  const applied = await applyRuntime(result.provider, result.model);
  if (!applied.ok) {
    await patchPrefs({
      provider: prevPrefs.provider,
      model: prevPrefs.model,
    });
    return { ok: false, error: applied.error ?? "运行时重载失败" };
  }
  return result;
}
