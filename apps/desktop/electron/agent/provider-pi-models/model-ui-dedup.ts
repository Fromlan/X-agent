/**
 * provider-pi-models / model-ui-dedup —— UI / 启动 prune 用的 key 工具
 * (issue #68 主题 J C-103).
 *
 * 唯一职责: 给 `Record<string, unknown>` 形态的 auth / models 顶层 map 做
 * case-insensitive prune + 同 (provider, id) UI 去重. 不依赖 model-shape
 * (塑形) 也不依赖 model-repair (启动期修复).
 *
 * 拆出来的好处:
 * - provider-pi-sync 的 syncProfileToPi / pruneProviderIdFromPi 都用它
 *   prune 大小写变体, 但 sync 那块只想 import 这一把剪刀, 不需要塑形
 *   helper 的 100+ 行.
 * - dedupeModelInfosForUi 是 renderer 渲染前的最后一道去重, 跟磁盘 IO
 *   没关系, 单测好覆盖.
 */

/**
 * Remove models.json / auth.json keys that would shadow the active provider:
 * - exact previous providerId (after rename)
 * - case-insensitive duplicates of keepProviderId (e.g. DeepSeek vs deepseek)
 */
export function pruneStaleProviderKeys(
  providers: Record<string, unknown>,
  keepProviderId: string,
  alsoRemove: readonly string[] = [],
): string[] {
  const keep = keepProviderId.trim();
  if (!keep) return [];
  const keepLower = keep.toLowerCase();
  const removeExact = new Set(
    alsoRemove.map((k) => k.trim()).filter((k) => k && k !== keep),
  );
  const removed: string[] = [];
  for (const key of Object.keys(providers)) {
    if (key === keep) continue;
    if (removeExact.has(key) || key.toLowerCase() === keepLower) {
      delete providers[key];
      removed.push(key);
    }
  }
  return removed;
}

/** UI list: collapse case-variant provider duplicates, prefer preferredProvider. */
export function dedupeModelInfosForUi<
  T extends { provider: string; id: string },
>(models: readonly T[], preferredProvider: string | null | undefined): T[] {
  const preferred = preferredProvider?.trim() ?? "";
  const byKey = new Map<string, T>();
  for (const m of models) {
    const key = `${m.provider.toLowerCase()}/${m.id.toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, m);
      continue;
    }
    if (preferred && m.provider === preferred && existing.provider !== preferred) {
      byKey.set(key, m);
    }
  }
  return [...byKey.values()];
}
