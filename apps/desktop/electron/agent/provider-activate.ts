/**
 * Provider Activate — write Pi files + prefs, then apply runtime, with rollback.
 */
import type { ProviderActivateResult } from "../../shared/ipc";
import { loadPrefs, patchPrefs } from "./prefs";
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
  const prevPrefs = loadPrefs();
  const result = activateProviderProfile(id, paths);
  if (!result.ok || !result.provider || !result.model) return result;

  const applied = await applyRuntime(result.provider, result.model);
  if (!applied.ok) {
    patchPrefs({ provider: prevPrefs.provider, model: prevPrefs.model });
    return { ok: false, error: applied.error ?? "运行时重载失败" };
  }
  return result;
}
