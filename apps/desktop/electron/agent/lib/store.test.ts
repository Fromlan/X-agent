/**
 * Vitest 并发回归套件 —— lib/store。
 *
 * 验证 Store.mutate 把整个读-改-写循环放进 per-path 锁:并发 mutate
 * (过去的 prefs / usage / provider 在锁外读 base,后写覆盖前写)不再丢更新;
 * 落盘 JSON 与缓存保持一致。
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, StoreMutationAborted } from "./store";

interface Counter {
  n: number;
}

let dirs: string[] = [];

/** 建临时目录并登记,afterEach 统一清理。 */
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "x-agent-store-vitest-"));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
  dirs = [];
});

describe("lib/store", () => {
  it("20 个并发 mutate 无丢更新,且落盘 JSON 与缓存一致", async () => {
    const dir = tempDir();
    const store = createStore<Counter>({
      filePath: join(dir, "x.json"),
      defaults: { n: 0 },
    });

    await Promise.all(
      Array.from({ length: 20 }, () => store.mutate((s) => ({ n: s.n + 1 }))),
    );

    expect(store.read().n).toBe(20);
    const disk = JSON.parse(
      readFileSync(join(dir, "x.json"), "utf8"),
    ) as Counter;
    expect(disk.n).toBe(20);
  });

  it("文件不存在时 mutate 的 prev 为 defaults,首次 mutate 落盘", async () => {
    const dir = tempDir();
    const store = createStore<Counter>({
      filePath: join(dir, "missing.json"),
      defaults: { n: 7 },
    });

    const next = await store.mutate((s) => ({ n: s.n + 1 }));

    expect(next.n).toBe(8);
    expect(store.read().n).toBe(8);
    const disk = JSON.parse(
      readFileSync(join(dir, "missing.json"), "utf8"),
    ) as Counter;
    expect(disk.n).toBe(8);
  });

  it("encode/decode 转换缓存值但不改变落盘 JSON 形状", async () => {
    const dir = tempDir();
    const store = createStore<{ v: string }>({
      filePath: join(dir, "x.json"),
      defaults: { v: "" },
      decode: (raw) => ({ v: String((raw as { v?: string }).v).toUpperCase() }),
      encode: (value) => ({ v: value.v.toLowerCase() }),
    });

    await store.mutate(() => ({ v: "AB" }));

    expect(store.read().v).toBe("AB");
    const disk = JSON.parse(
      readFileSync(join(dir, "x.json"), "utf8"),
    ) as { v: string };
    expect(disk.v).toBe("ab");
  });

  it("mutate fn 抛 StoreMutationAborted 时不写盘、不改缓存", async () => {
    const dir = tempDir();
    const path = join(dir, "x.json");
    const store = createStore<Counter>({ filePath: path, defaults: { n: 0 } });

    await expect(
      store.mutate(() => {
        throw new StoreMutationAborted("rejected");
      }),
    ).rejects.toThrow("rejected");
    expect(() => readFileSync(path, "utf8")).toThrow();
    expect(store.read().n).toBe(0);
  });

  it("write() 整体替换落盘并刷新缓存", async () => {
    const dir = tempDir();
    const store = createStore<Counter>({
      filePath: join(dir, "x.json"),
      defaults: { n: 0 },
    });

    await store.write({ n: 42 });

    expect(store.read().n).toBe(42);
    const disk = JSON.parse(
      readFileSync(join(dir, "x.json"), "utf8"),
    ) as Counter;
    expect(disk.n).toBe(42);
  });

  it("惰性路径切换(测试 override 场景)后 read 自动失效缓存", async () => {
    const dirA = tempDir();
    const dirB = tempDir();
    let path = join(dirA, "x.json");
    const store = createStore<Counter>({ filePath: () => path, defaults: { n: 0 } });

    await store.mutate((s) => ({ n: s.n + 1 }));
    expect(store.read().n).toBe(1);

    // 模拟 setXForTests 切换目标文件:同一 Store 实例应重新读盘而不是返回旧缓存。
    path = join(dirB, "x.json");
    expect(store.read().n).toBe(0);
  });

  it("损坏 JSON 的 decode 抛错时回退 defaults,不炸写路径", async () => {
    const dir = tempDir();
    const store = createStore<Counter>({
      filePath: join(dir, "x.json"),
      defaults: { n: 0 },
      decode: () => {
        throw new Error("bad data");
      },
    });

    const next = await store.mutate((s) => ({ n: s.n + 1 }));

    expect(next.n).toBe(1);
    expect(store.read().n).toBe(1);
  });
});
