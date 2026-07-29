/**
 * Pi AuthStorage caches auth.json in memory at create time. reloadConfig()
 * only reloads models.json — so after we write auth.json from provider
 * activate, credentials stay stale until this reload runs.
 */
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export function reloadAuthStorageCache(runtime: ModelRuntime): void {
  const store = (
    runtime as unknown as {
      credentials?: { store?: { reload?: () => void } };
    }
  ).credentials?.store;
  store?.reload?.();
}
