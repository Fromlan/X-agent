/**
 * Per-path async mutex. Serializes read-modify-write so concurrent
 * `recordTurnUsage` / `setProviderProfileEnabled` / `upsertProviderProfile`
 * don't lose updates.
 */
const chains = new Map<string, Promise<unknown>>();

export function withStoreLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  // 失败也不阻塞后续 caller —— 重置 chain 头部为 settled promise
  chains.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}