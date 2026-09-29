/**
 * Shared retry / timeout / backoff primitives.
 *
 * 收敛 11+ 处散落在 `electron/agent/` 下的 `setTimeout` 超时与 magic number，
 * 让 godot-rpc-bridge / model-fetch / git-exec / auto-updater / main-splash /
 * 后续 truncation-recovery / auto-maintain 共享同一套语义。设计参考
 * deepseek-harness 的 `packages/util/timeout` + `packages/llm/llm-retry`：
 *
 *   - `clampTimeout`: 拒绝非 finite / 非 positive，统一把 undefined 视作
 *     「未指定 → 用 backend default」，超过 max 截到 max；非法值抛错而非
 *     静默回退（避免上游 `0` 把超时关掉）。
 *   - `cancellableDelay`: 与 AbortSignal 双向绑定的 setTimeout 返回值；
 *     被 abort 时立刻 resolve(false) 并 clearTimeout，调用方据此「提前醒来」。
 *   - `boundedExpBackoff`: DSH 风格的 `initialDelay * 2^(retry-1)` 钳制 +
 *     `(1 - ratio) + 2*ratio*random()` 对称抖动；jitterRatio=0 时退化为
 *     纯指数、`maxDelayMs` 钳制永远命中。
 *   - `RetryReason`: 携带 capability-owned code + 实际 elapsed ms；
 *     `timeoutOf` 工具从 AbortSignal.reason 反向解析，仅识别匹配的
 *     RetryReason（避免嵌套 abort 把外层 timeout 吞掉）。
 *
 * 单元测试见 ./retry.test.ts。
 */

/**
 * Node 不把 setTimeout 钳制到 1ms 的最大延迟。DeepSeek 的 dsh-timeout 把
 * 这个常量定为 2^31-1；本仓库沿用同一边界，让 `clampTimeout` 的 max 直接
 * 取这个值时也能通过 `assertTimerDelay`。
 */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** Capability-owned timeout code, e.g. `GODOT_RPC_TIMEOUT`. */
export type RetryCode = string;

/**
 * Abort reason carrying a capability-owned code + the deadline that elapsed.
 * The cause survives across Promise.race chains so a downstream consumer can
 * classify a timeout via `timeoutOf(signal, code)` rather than message
 * matching.
 */
export class RetryReason extends Error {
  override name = "RetryReason";

  constructor(readonly code: RetryCode, readonly timeoutMs: number) {
    super(`${code} after ${timeoutMs}ms`);
  }
}

function assertTimerDelay(timeoutMs: number, name: string): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `${name} must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    );
  }
}

/**
 * 校验调用方的可选超时提示，应用 backend default，钳制到 max。`undefined`
 * 走 default；显式传入的非法值（<=0 / 非 finite）抛错——避免上游用 `0`
 * 静默关掉超时导致永久挂起。`name` 仅在错误消息里出现，便于定位。
 *
 * @param requested 调用方的提示；未传 → `undefined`
 * @param def 必填：backend default
 * @param max 必填：backend upper bound
 * @param name 字段名，仅在 throw 时使用
 * @returns `min(requested ?? def, max)`
 */
export function clampTimeout(
  requested: number | undefined,
  def: number,
  max: number,
  name = "timeoutMs",
): number {
  assertTimerDelay(def, `${name}.default`);
  assertTimerDelay(max, `${name}.max`);
  if (requested !== undefined && (!Number.isFinite(requested) || requested <= 0)) {
    throw new Error(`${name} must be a positive finite number`);
  }
  return Math.min(requested ?? def, max);
}

/**
 * 与 AbortSignal 双向绑定的延时：被 abort 立刻 resolve(false) 并 clearTimeout，
 * 计时到点 resolve(true)。返回 boolean 让调用方区分「睡足 / 被叫醒」。
 *
 * `delayMs <= 0` 不调度 timer，立刻 resolve(true)（不等同于「永不超时」，
 * 仅是「没等」）。`signal` 已 abort 时同样 resolve(false)。
 *
 * @param delayMs 延时毫秒；`<= 0` 不调度
 * @param signal 任意上游 cancellation signal；abort 立即醒来
 */
export function cancellableDelay(
  delayMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  if (delayMs <= 0) return Promise.resolve(true);
  assertTimerDelay(delayMs, "cancellableDelay delayMs");
  return new Promise((resolve) => {
    let done = false;
    const onAbort = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Backoff knobs. 字段语义与 DSH 的 `ResolvedRetryBackoff` 一一对应；jitter
 * 是对称的——`random()=0` → 1-ratio，`random()=1` → 1+ratio。
 */
export interface BoundedExpBackoffOptions {
  /** Initial local backoff in ms (DSH default 500). */
  initialDelayMs?: number;
  /** Upper bound on the locally scheduled delay in ms (DSH default 10_000). */
  maxDelayMs?: number;
  /** Symmetric jitter ratio around 1, in [0, 1] (DSH default 0.1). */
  jitterRatio?: number;
  /** Test seam: sample in [0, 1). Production uses Math.random. */
  random?: () => number;
}

const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 10_000;
const DEFAULT_JITTER_RATIO = 0.1;

/**
 * 计算第 `retry` 次本地退避延迟（retry 1-indexed；retry=1 即初始值）。
 *
 *   exponent = min(retry - 1, 1024)        // 防 2^n 爆炸
 *   exponential = min(initialDelayMs * 2^exponent, maxDelayMs)
 *   jitter = (1 - ratio) + 2 * ratio * random()    // ∈ [1-ratio, 1+ratio]
 *   return min(exponential * jitter, maxDelayMs)
 *
 * `jitterRatio=0` 时退化为纯指数；`random=() => 0.5` 时无 jitter 的中心值。
 * 非法配置（负数 / NaN / ratio 越界）抛错，避免静默产出 0ms 风暴。
 *
 * @param retry 第几次重试，>= 1（caller 自管 cap；本函数不强制 maxRetries）
 * @param options 配置；缺省取 DSH 默认值
 */
export function boundedExpBackoff(
  retry: number,
  options: BoundedExpBackoffOptions = {},
): number {
  if (!Number.isInteger(retry) || retry < 1) {
    throw new Error(`retry must be a positive integer (got ${retry})`);
  }
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const jitterRatio = options.jitterRatio ?? DEFAULT_JITTER_RATIO;
  const random = options.random ?? Math.random;
  if (
    !Number.isFinite(initialDelayMs) ||
    initialDelayMs <= 0 ||
    initialDelayMs > MAX_TIMER_DELAY_MS
  ) {
    throw new Error(
      `initialDelayMs must be a positive finite number (got ${initialDelayMs})`,
    );
  }
  if (
    !Number.isFinite(maxDelayMs) ||
    maxDelayMs <= 0 ||
    maxDelayMs > MAX_TIMER_DELAY_MS
  ) {
    throw new Error(
      `maxDelayMs must be a positive finite number (got ${maxDelayMs})`,
    );
  }
  if (initialDelayMs > maxDelayMs) {
    throw new Error(
      `initialDelayMs (${initialDelayMs}) must be <= maxDelayMs (${maxDelayMs})`,
    );
  }
  if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) {
    throw new Error(`jitterRatio must be in [0, 1] (got ${jitterRatio})`);
  }
  // Cap the exponent so 2^retry doesn't overflow for absurd retry counts.
  // 1024 is well past any sane cap (DSH uses the same constant); the
  // exponential is then clamped to maxDelayMs.
  const exponent = Math.min(retry - 1, 1024);
  const exponential = Math.min(initialDelayMs * 2 ** exponent, maxDelayMs);
  const jitter = 1 - jitterRatio + 2 * jitterRatio * random();
  return Math.min(exponential * jitter, maxDelayMs);
}

/**
 * 从 AbortSignal.reason（任意 `{ reason }` 载体）反查匹配的 RetryReason。
 * 传 `code` 时仅在 `RetryReason.code` 严格相等时返回，避免嵌套 abort 把
 * 外层 timeout 吞成内层的普通 cancellation。
 *
 * @param timer AbortSignal 或任意带 `reason` 的对象（如 caught abort error）
 * @param code 可选；不传则任意 RetryReason 都算
 */
export function timeoutOf(
  timer: AbortSignal | { reason?: unknown },
  code?: RetryCode,
): RetryReason | undefined {
  const reason: unknown = timer.reason;
  if (!(reason instanceof RetryReason)) return undefined;
  return code === undefined || reason.code === code ? reason : undefined;
}

/**
 * Fuse upstream cancellation with an internal timeout into one signal. The
 * returned signal aborts on whichever source wins first. Convenience over
 * `AbortSignal.any([upstream, internal.signal])` with the boilerplate
 * (timer cleanup, finite timeoutMs validation) handled.
 *
 * @param upstream 调用方的 cancellation signal；可能为 undefined
 * @param timeoutMs 超时毫秒；`<= 0` 不调度 timer（等价于「无超时」）
 * @param code 落到 RetryReason.code 的 capability-owned 标识
 * @returns fused AbortSignal + dispose timer cleanup
 */
export function fusedTimeoutSignal(
  upstream: AbortSignal | undefined,
  timeoutMs: number,
  code: RetryCode,
): { signal: AbortSignal; dispose: () => void } {
  if (timeoutMs <= 0) {
    return {
      signal: upstream ?? new AbortController().signal,
      dispose: () => {},
    };
  }
  assertTimerDelay(timeoutMs, "fusedTimeoutSignal timeoutMs");
  const internal = new AbortController();
  const id = setTimeout(() => {
    internal.abort(new RetryReason(code, timeoutMs));
  }, timeoutMs);
  const signal =
    upstream !== undefined
      ? AbortSignal.any([upstream, internal.signal])
      : internal.signal;
  return {
    signal,
    dispose: () => clearTimeout(id),
  };
}
