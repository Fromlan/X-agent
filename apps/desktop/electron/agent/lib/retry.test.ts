/**
 * Vitest 套件 —— 锁住 retry lib 的语义。
 *
 * `clampTimeout` 拒绝非法值；`cancellableDelay` 在 vi.useFakeTimers 下双向
 * 收敛；`boundedExpBackoff` 在 random=() => 0.5 的中位值 + 边界钳制下可
 * 重复。`RetryReason` / `timeoutOf` 携带 code + elapsed ms，被吞时仍能
 * 区分。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  boundedExpBackoff,
  cancellableDelay,
  clampTimeout,
  fusedTimeoutSignal,
  MAX_TIMER_DELAY_MS,
  RetryReason,
  timeoutOf,
} from "./retry";

describe("MAX_TIMER_DELAY_MS", () => {
  it("暴露 Node 钳制边界 2^31-1", () => {
    expect(MAX_TIMER_DELAY_MS).toBe(2_147_483_647);
  });
});

describe("RetryReason", () => {
  it("携带 code + timeoutMs，name 固定为 RetryReason", () => {
    const r = new RetryReason("GODOT_RPC_TIMEOUT", 4000);
    expect(r.code).toBe("GODOT_RPC_TIMEOUT");
    expect(r.timeoutMs).toBe(4000);
    expect(r.name).toBe("RetryReason");
    expect(r.message).toBe("GODOT_RPC_TIMEOUT after 4000ms");
  });

  it("instanceof Error 兼容旧 throw 路径", () => {
    const r = new RetryReason("X", 1);
    expect(r).toBeInstanceOf(Error);
    expect(r).toBeInstanceOf(RetryReason);
  });
});

describe("clampTimeout", () => {
  it("undefined 走 default", () => {
    expect(clampTimeout(undefined, 1000, 5000)).toBe(1000);
  });

  it("显式合法值原样通过", () => {
    expect(clampTimeout(2000, 1000, 5000)).toBe(2000);
  });

  it("超过 max 截到 max", () => {
    expect(clampTimeout(9999, 1000, 5000)).toBe(5000);
  });

  it("等于 max 仍合法", () => {
    expect(clampTimeout(5000, 1000, 5000)).toBe(5000);
  });

  it("非法值 0 / 负数 / NaN / Infinity 抛错而非静默回退", () => {
    expect(() => clampTimeout(0, 1000, 5000)).toThrow(/positive finite/);
    expect(() => clampTimeout(-1, 1000, 5000)).toThrow(/positive finite/);
    expect(() => clampTimeout(NaN, 1000, 5000)).toThrow(/positive finite/);
    expect(() => clampTimeout(Infinity, 1000, 5000)).toThrow(/positive finite/);
  });

  it("default / max 非法也抛错（防止 backend 配错）", () => {
    expect(() => clampTimeout(undefined, 0, 5000)).toThrow(/default/);
    expect(() => clampTimeout(undefined, 1000, 0)).toThrow(/max/);
    expect(() => clampTimeout(undefined, -1, 5000)).toThrow(/default/);
    expect(() => clampTimeout(undefined, NaN, 5000)).toThrow(/default/);
  });

  it("name 进入错误消息便于定位", () => {
    expect(() => clampTimeout(0, 1000, 5000, "waitMs")).toThrow(/waitMs/);
  });
});

describe("cancellableDelay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("计时到点 resolve(true)", async () => {
    const promise = cancellableDelay(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBe(true);
  });

  it("未到点 resolve 仍是 pending；advance 后才醒来", async () => {
    let settled: boolean | undefined;
    const promise = cancellableDelay(1000).then((v) => {
      settled = v;
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(500);
    await promise;
    expect(settled).toBe(true);
  });

  it("signal 已 abort 立即 resolve(false)", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(cancellableDelay(1000, controller.signal)).resolves.toBe(false);
  });

  it("signal 在中途 abort 后提前 resolve(false)，不再 fire timer", async () => {
    const controller = new AbortController();
    let settled: boolean | undefined;
    void cancellableDelay(1000, controller.signal).then((v) => {
      settled = v;
    });
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    // resolve 是 microtask，等一拍再断言
    await Promise.resolve();
    expect(settled).toBe(false);
    // 再 advance 到原 deadline，timer 不应再 fire（done=true 时 no-op）
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);
  });

  it("delayMs <= 0 立刻 resolve(true)（仅「没等」不等同于「永不超时」）", async () => {
    await expect(cancellableDelay(0)).resolves.toBe(true);
    await expect(cancellableDelay(-1)).resolves.toBe(true);
  });

  it("非法 delayMs 抛错（NaN / Infinity / 超过 MAX_TIMER_DELAY_MS）", () => {
    expect(() => cancellableDelay(NaN)).toThrow(/cancellableDelay/);
    expect(() => cancellableDelay(Infinity)).toThrow(/cancellableDelay/);
    expect(() => cancellableDelay(MAX_TIMER_DELAY_MS + 1)).toThrow(/cancellableDelay/);
  });
});

describe("boundedExpBackoff", () => {
  it("jitterRatio=0 + random 固定时为纯指数", () => {
    const r = () => 0.5;
    // initial=500, jitter=0 → 第 1 次 500, 第 2 次 1000, 第 5 次 8000
    expect(boundedExpBackoff(1, { initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0, random: r })).toBe(500);
    expect(boundedExpBackoff(2, { initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0, random: r })).toBe(1000);
    expect(boundedExpBackoff(5, { initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0, random: r })).toBe(8000);
  });

  it("jitterRatio=0.1 + random=0.5 时 jitter=1（中位值）", () => {
    const opts = { initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0.1, random: () => 0.5 };
    // 与 jitterRatio=0 等价
    expect(boundedExpBackoff(1, opts)).toBe(500);
    expect(boundedExpBackoff(2, opts)).toBe(1000);
  });

  it("jitterRatio=0.1 + random=0 → 下限 (1-0.1)=0.9 倍", () => {
    const opts = { initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0.1, random: () => 0 };
    // 第 1 次: min(500 * 0.9, 10_000) = 450
    expect(boundedExpBackoff(1, opts)).toBe(450);
  });

  it("jitterRatio=0.1 + random=1 → 上限 (1+0.1)=1.1 倍", () => {
    const opts = { initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0.1, random: () => 1 };
    // 第 1 次: min(500 * 1.1, 10_000) = 550
    expect(boundedExpBackoff(1, opts)).toBe(550);
  });

  it("maxDelayMs 命中钳制", () => {
    const opts = { initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0, random: () => 0.5 };
    // 第 5 次 8000, 第 6 次 min(16000, 10000)=10000
    expect(boundedExpBackoff(5, opts)).toBe(8000);
    expect(boundedExpBackoff(6, opts)).toBe(10_000);
    expect(boundedExpBackoff(20, opts)).toBe(10_000);
  });

  it("exponent 钳到 1024 防 2^n 爆炸", () => {
    // 即使 retry=99999，仍走 exponent=1024（2^1024 ≈ Infinity）→ clamp 到 max
    const opts = { initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0, random: () => 0.5 };
    expect(boundedExpBackoff(99_999, opts)).toBe(10_000);
  });

  it("非法 retry（<1 / 非整数）抛错", () => {
    expect(() => boundedExpBackoff(0)).toThrow(/positive integer/);
    expect(() => boundedExpBackoff(-1)).toThrow(/positive integer/);
    expect(() => boundedExpBackoff(1.5)).toThrow(/positive integer/);
  });

  it("非法 initialDelayMs / maxDelayMs / jitterRatio 抛错", () => {
    expect(() => boundedExpBackoff(1, { initialDelayMs: 0 })).toThrow(/initialDelayMs/);
    expect(() => boundedExpBackoff(1, { initialDelayMs: -1 })).toThrow(/initialDelayMs/);
    expect(() => boundedExpBackoff(1, { maxDelayMs: 0 })).toThrow(/maxDelayMs/);
    expect(() => boundedExpBackoff(1, { jitterRatio: -0.1 })).toThrow(/jitterRatio/);
    expect(() => boundedExpBackoff(1, { jitterRatio: 1.5 })).toThrow(/jitterRatio/);
    expect(() =>
      boundedExpBackoff(1, { initialDelayMs: 1000, maxDelayMs: 500 }),
    ).toThrow(/initialDelayMs.*<= maxDelayMs/);
  });

  it("DSH 默认值即 initialDelay=500 / maxDelay=10000 / jitterRatio=0.1", () => {
    // jitter 中心值 (random=0.5) 下，第 1 次 500，第 6 次起命中 max
    const opts = { random: () => 0.5 };
    expect(boundedExpBackoff(1, opts)).toBe(500);
    expect(boundedExpBackoff(2, opts)).toBe(1000);
    expect(boundedExpBackoff(3, opts)).toBe(2000);
    expect(boundedExpBackoff(4, opts)).toBe(4000);
    expect(boundedExpBackoff(5, opts)).toBe(8000);
    expect(boundedExpBackoff(6, opts)).toBe(10_000);
  });
});

describe("timeoutOf", () => {
  it("AbortSignal.reason 是 RetryReason 时返回；code 匹配严格", () => {
    const controller = new AbortController();
    controller.abort(new RetryReason("X", 100));
    expect(timeoutOf(controller.signal, "X")?.code).toBe("X");
    expect(timeoutOf(controller.signal, "Y")).toBeUndefined();
  });

  it("不传 code 时任意 RetryReason 都算", () => {
    const controller = new AbortController();
    controller.abort(new RetryReason("ANY", 1));
    expect(timeoutOf(controller.signal)?.code).toBe("ANY");
  });

  it("非 RetryReason reason 返回 undefined", () => {
    const controller = new AbortController();
    controller.abort(new Error("plain"));
    expect(timeoutOf(controller.signal, "X")).toBeUndefined();
  });
});

describe("fusedTimeoutSignal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("timeoutMs <= 0 不调度 timer（无超时）", () => {
    const { signal, dispose } = fusedTimeoutSignal(undefined, 0, "X");
    expect(signal.aborted).toBe(false);
    dispose();
  });

  it("upstream 已 abort → signal 同步 aborted", () => {
    const upstream = new AbortController();
    upstream.abort();
    const { signal } = fusedTimeoutSignal(upstream.signal, 1000, "X");
    expect(signal.aborted).toBe(true);
  });

  it("timer 到点 → signal 带 RetryReason abort", async () => {
    const { signal, dispose } = fusedTimeoutSignal(undefined, 500, "GODOT_RPC_TIMEOUT");
    await vi.advanceTimersByTimeAsync(500);
    expect(signal.aborted).toBe(true);
    const reason = timeoutOf(signal, "GODOT_RPC_TIMEOUT");
    expect(reason?.timeoutMs).toBe(500);
    dispose();
  });

  it("upstream abort 抢先 → timer 不再 fire，dispose 安全", async () => {
    const upstream = new AbortController();
    const { signal, dispose } = fusedTimeoutSignal(upstream.signal, 1000, "X");
    upstream.abort();
    await vi.advanceTimersByTimeAsync(2000); // 即使过 deadline 也不应再 abort
    expect(timeoutOf(signal, "X")).toBeUndefined();
    expect(signal.aborted).toBe(true); // upstream 是其中一个源
    dispose();
  });

  it("非法 timeoutMs 抛错", () => {
    expect(() => fusedTimeoutSignal(undefined, -1, "X")).not.toThrow(); // <=0 走无超时
    expect(() => fusedTimeoutSignal(undefined, NaN, "X")).toThrow(/timeoutMs/);
    expect(() => fusedTimeoutSignal(undefined, Infinity, "X")).toThrow(/timeoutMs/);
  });
});
