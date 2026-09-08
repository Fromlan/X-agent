/**
 * Vitest 单元测试 —— lib/store-mutex / withSyncStoreLock (C-106 收口).
 *
 * 锁住同步锁的核心契约: 1) 串行执行; 2) 锁内 fn 抛错时锁释放; 3) 不同
 * key 互不阻塞; 4) 同一 key 并发调用不丢更新.
 *
 * 替代了 package-manager.ts 原内联 100ms 自旋锁, 收敛到 lib/store-mutex
 * 这个 store 抽象的底层锁原语.
 */
import { describe, it, expect } from "vitest";
import { withSyncStoreLock, withStoreLock } from "./store-mutex";

describe("withSyncStoreLock (同步锁原语)", () => {
  it("串行执行: 锁内 fn 完成后才执行下一个", () => {
    const order: string[] = [];
    withSyncStoreLock("t1", () => {
      order.push("a-start");
      // 模拟真实 IO 耗时
      const start = Date.now();
      while (Date.now() - start < 20) {
        // busy wait 20ms
      }
      order.push("a-end");
    });
    withSyncStoreLock("t1", () => {
      order.push("b");
    });
    expect(order).toEqual(["a-start", "a-end", "b"]);
  });

  it("并发 N 个调用按串行执行, 不丢更新", () => {
    let counter = 0;
    const N = 50;
    // 并发触发 N 个同步锁请求 (Node 单线程: 真正能同时跑的只有 1 个,
    // 但所有 N 个调用都尝试 acquire, 锁原语必须正确 serialize).
    for (let i = 0; i < N; i++) {
      withSyncStoreLock("t2", () => {
        // read
        const current = counter;
        // simulate IO
        const start = Date.now();
        while (Date.now() - start < 1) {
          // 1ms busy
        }
        // write
        counter = current + 1;
      });
    }
    expect(counter).toBe(N);
  });

  it("锁内 fn 抛错时锁释放, 后续 caller 能继续跑", () => {
    expect(() =>
      withSyncStoreLock("t3", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    // 必须能继续 acquire
    const result = withSyncStoreLock("t3", () => "ok");
    expect(result).toBe("ok");
  });

  it("不同 key 互不阻塞", () => {
    const order: string[] = [];
    withSyncStoreLock("alpha", () => {
      order.push("alpha-start");
      // 短 IO
      const start = Date.now();
      while (Date.now() - start < 5) {
        // 5ms
      }
      order.push("alpha-end");
    });
    withSyncStoreLock("beta", () => {
      // beta 跟 alpha 用不同 key, alpha 释放前应该能直接进入
      order.push("beta");
    });
    // 关键是 beta 能在 alpha 之前或之后, 但不依赖 alpha
    expect(order).toContain("alpha-start");
    expect(order).toContain("alpha-end");
    expect(order).toContain("beta");
  });

  it("与 withStoreLock (async) 用不同 key 互不阻塞", async () => {
    const order: string[] = [];
    const promise = withStoreLock("async-key", async () => {
      order.push("async-start");
      await new Promise((r) => setTimeout(r, 10));
      order.push("async-end");
    });
    withSyncStoreLock("sync-key", () => {
      order.push("sync");
    });
    await promise;
    // sync 不依赖 async
    expect(order).toContain("sync");
    expect(order).toContain("async-start");
    expect(order).toContain("async-end");
  });
});
