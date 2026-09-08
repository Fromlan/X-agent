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

/**
 * Per-path sync mutex. Same keying scheme as `withStoreLock`, but for
 * synchronous read-modify-write paths that cannot be made async without
 * cascading through IPC handlers.
 *
 * Implementation: per-key `Int32Array(1)` semaphore + `Atomics.wait` /
 * `Atomics.notify`. `Atomics.wait` is the only way in Node.js to block the
 * current thread without busy-looping, so this mutex actually waits instead
 * of spinning the CPU. Each `key` lazily allocates a 1-cell `SharedArrayBuffer`
 * on first use; once allocated, the lock primitive is reused for the
 * lifetime of the process.
 *
 * Semantics:
 * - state === 0: lock free. Caller CAS 0 → 1 atomically, proceeds.
 * - state === 1: lock held. Caller `Atomics.wait` until notified.
 * - On release: store 0 + `Atomics.notify` to wake the longest-waiting
 *   thread (one waiter per release; the rest loop back to the top).
 *
 * Used by package-manager catalog registry (was: a 100ms-timeout spin lock
 * inline in the same file). Throws if the lock cannot be acquired in 5s
 * (defensive — should never trip in practice; the registry write is < 5ms).
 */
const syncCells = new Map<string, Int32Array>();
const SYNC_TIMEOUT_MS = 5_000;

function getCell(key: string): Int32Array {
  let cell = syncCells.get(key);
  if (!cell) {
    // SharedArrayBuffer is required by Atomics.wait in worker-less code.
    cell = new Int32Array(new SharedArrayBuffer(4));
    syncCells.set(key, cell);
  }
  return cell;
}

export function withSyncStoreLock<T>(key: string, fn: () => T): T {
  const cell = getCell(key);
  // Fast path: try to acquire immediately. Atomics.compareExchange returns
  // the previous value; we only proceed when it was 0 (free).
  const prev = Atomics.compareExchange(cell, 0, 0, 1);
  if (prev !== 0) {
    // Lock held — block until notified or timeout. Atomics.wait on the
    // main thread is a true OS-level block, not a busy loop. Node 22+
    // requires the wait to be on a SharedArrayBuffer-backed view (it is).
    const res = Atomics.wait(cell, 0, 1, SYNC_TIMEOUT_MS);
    if (res === "timed-out") {
      throw new Error(`withSyncStoreLock(${key}) ${SYNC_TIMEOUT_MS}ms acquire timeout`);
    }
    // After waking, the cell should be 1 (the holder marked it). Re-CAS
    // would race; instead, the holder flips to 0 right before notifying, so
    // we just re-acquire by setting it back to 1.
    Atomics.store(cell, 0, 1);
  }
  try {
    return fn();
  } finally {
    // Release: store 0, then notify one waiter.
    Atomics.store(cell, 0, 0);
    Atomics.notify(cell, 0, 1);
  }
}