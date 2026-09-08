/**
 * Vitest 套件 —— src/hooks/withBusyLifecycle.
 *
 * 锁住 5 个不变量 (issue #61 主题 F C-203):
 * 1. fn 成功 → setBusy(true) → setError(null) → setBusy(false) 顺序
 * 2. fn 抛错 → 仍然 setBusy(false) (finally)
 * 3. fn 抛错 → 错误向上抛 (不让 setBusy 吞掉)
 * 4. setError(null) 总在 setBusy(true) 之后、fn 之前
 * 5. setBusy(false) 总在 fn 之后 (成功 / 失败都要执行)
 */
import { describe, it, expect, vi } from "vitest";
import { withBusyLifecycle } from "./withBusyLifecycle";

function makeSetters() {
  const setBusy = vi.fn();
  const setError = vi.fn();
  return { setBusy, setError };
}

describe("withBusyLifecycle —— 成功路径", () => {
  it("顺序: setBusy(true) → setError(null) → fn → setBusy(false)", async () => {
    const { setBusy, setError } = makeSetters();
    const order: string[] = [];
    setBusy.mockImplementation((v: boolean) =>
      order.push(v ? "setBusy(true)" : "setBusy(false)"),
    );
    setError.mockImplementation(() => order.push("setError(null)"));
    const fn = vi.fn(async () => {
      order.push("fn");
    });

    await withBusyLifecycle(setBusy, setError, fn);

    expect(order).toEqual(["setBusy(true)", "setError(null)", "fn", "setBusy(false)"]);
  });

  it("setError(null) 总会调用 (避免上一次错误残留)", async () => {
    const { setBusy, setError } = makeSetters();
    await withBusyLifecycle(setBusy, setError, async () => undefined);
    const nullCalls = setError.mock.calls.filter(([v]) => v === null);
    expect(nullCalls.length).toBe(1);
  });

  it("setBusy(true) 和 setBusy(false) 各调用 1 次", async () => {
    const { setBusy, setError } = makeSetters();
    await withBusyLifecycle(setBusy, setError, async () => undefined);
    expect(setBusy).toHaveBeenCalledTimes(2);
    expect(setBusy).toHaveBeenNthCalledWith(1, true);
    expect(setBusy).toHaveBeenNthCalledWith(2, false);
  });
});

describe("withBusyLifecycle —— 失败路径", () => {
  it("fn 抛错 → setBusy(false) 仍执行 (finally)", async () => {
    const { setBusy, setError } = makeSetters();
    const fn = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(withBusyLifecycle(setBusy, setError, fn)).rejects.toThrow("boom");
    expect(setBusy).toHaveBeenNthCalledWith(2, false);
  });

  it("fn 抛错 → 错误原样向上抛 (不吞错)", async () => {
    const { setBusy, setError } = makeSetters();
    const err = new Error("upstream failure");
    const fn = vi.fn(async () => {
      throw err;
    });

    let caught: unknown;
    try {
      await withBusyLifecycle(setBusy, setError, fn);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(err);
  });

  it("fn 抛错 → setError(null) 已经清空 (调用顺序保证)", async () => {
    const { setBusy, setError } = makeSetters();
    const order: string[] = [];
    setBusy.mockImplementation((v: boolean) =>
      order.push(v ? "setBusy(true)" : "setBusy(false)"),
    );
    setError.mockImplementation(() => order.push("setError(null)"));

    await expect(
      withBusyLifecycle(setBusy, setError, async () => {
        throw new Error("x");
      }),
    ).rejects.toThrow();
    // setError(null) 在 fn 之前已经清掉, fn 内部抛错不影响 setError 状态
    expect(order).toEqual(["setBusy(true)", "setError(null)", "setBusy(false)"]);
    expect(setBusy).toHaveBeenLastCalledWith(false);
  });
});

describe("withBusyLifecycle —— 6 useWorkspaceSession case 一致契约", () => {
  it("open / newSession / resume / delete / deleteProject / close 都满足同一契约", async () => {
    // 模拟 6 个业务 callback, 每个都期望:
    // - 进入时 setBusy(true) + setError(null)
    // - 退出时 setBusy(false) (无论成功失败)
    const cases: Array<{ name: string; body: () => Promise<void> }> = [
      { name: "open", body: async () => undefined },
      { name: "new", body: async () => undefined },
      { name: "resume", body: async () => undefined },
      { name: "delete", body: async () => undefined },
      { name: "deleteProject", body: async () => undefined },
      { name: "close", body: async () => undefined },
    ];
    for (const c of cases) {
      const { setBusy, setError } = makeSetters();
      await withBusyLifecycle(setBusy, setError, c.body);
      expect(setBusy).toHaveBeenNthCalledWith(1, true);
      expect(setBusy).toHaveBeenLastCalledWith(false);
      expect(setError).toHaveBeenCalledWith(null);
    }
  });
});
