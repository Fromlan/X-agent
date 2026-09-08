/**
 * Vitest 单元测试 —— pi-auth-port / pi-models-port 并发锁隔离 (C-105 收口)
 *
 * 收口动机: provider-pi-sync.ts 在 2026-08-31 把 read-modify-write 三件套
 * (readJsonFile / writeJsonAtomic / withStoreLock) 抽到 pi-auth-port 和
 * pi-models-port 两个 port, 让 syncProfileToPi / pruneProviderIdFromPi
 * 并发激活档案时不互踩丢 key. 本测试锁住这条契约:
 *
 * 1. 并发 N 个 withAuthLock mutate 写不同 providerId key, 完成后所有 key 都
 *    落盘 — 没有 read-modify-write 互相覆盖 (丢更新).
 * 2. 锁的 key 按 paths 隔离: 同一进程的 paths 互不阻塞, 不同 paths 互不干扰.
 * 3. mutate 闭包抛错时, 锁释放, 后续 mutate 能继续跑 (chain 不死锁).
 * 4. auth 与 models 各用各的锁, 互不阻塞 (这是 syncProfileToPi 走 2 个锁的
 *    前提).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withAuthLock, readAuthFile } from "./pi-auth-port";
import { withModelsLock, readModelsFile } from "./pi-models-port";
import type { ProviderPaths } from "../provider-persist";

let tmp: string;
let paths: ProviderPaths;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "x-agent-pi-port-concurrency-"));
  paths = {
    agentDir: tmp,
    storePath: join(tmp, "x-agent-providers.json"),
    authPath: join(tmp, "auth.json"),
    modelsPath: join(tmp, "models.json"),
  };
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("pi-auth-port / withAuthLock 并发锁隔离", () => {
  it("并发 N 个 mutate 写不同 providerId key, 全部落盘不丢更新", async () => {
    const N = 8;
    const providers = Array.from({ length: N }, (_, i) => `provider-${i}`);
    // 每个 mutate 在闭包里 await 一下, 模拟真实写盘耗时 — 不加锁就会
    // 读到陈旧值, 后写覆盖前写, 丢更新.
    await Promise.all(
      providers.map((id) =>
        withAuthLock(paths, async (auth) => {
          // 读最新 (锁内读, 起点必须空 — 后续 N-1 仍能看见前一个的写入)
          const fresh = await readAuthFile(paths);
          // 模拟 IO
          await new Promise((r) => setTimeout(r, 5));
          // 用 fresh 而不是闭包参数, 真正走 read-modify-write
          fresh[id] = { type: "api_key", key: `key-${id}` };
          await import("./pi-auth-port").then((m) =>
            m.writeAuthFile(paths, fresh),
          );
          return id;
        }),
      ),
    );
    const final = await readAuthFile(paths);
    expect(Object.keys(final).sort()).toEqual(providers.sort());
  });

  it("mutate 抛错时锁释放, 后续 mutate 能继续跑", async () => {
    // 第一个 mutate 故意抛错, 锁必须释放让后续 caller 跑通
    await expect(
      withAuthLock(paths, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    // 后续 mutate 必须能成功
    const result = await withAuthLock(paths, async (auth) => {
      auth["survivor"] = { type: "api_key", key: "k" };
      await import("./pi-auth-port").then((m) =>
        m.writeAuthFile(paths, auth),
      );
      return "ok";
    });
    expect(result).toBe("ok");
    const final = await readAuthFile(paths);
    expect(final["survivor"]?.key).toBe("k");
  });
});

describe("pi-models-port / withModelsLock 并发锁隔离", () => {
  it("并发 N 个 mutate 写不同 provider 的 models 数组, 全部落盘", async () => {
    const N = 8;
    const providers = Array.from({ length: N }, (_, i) => `prov-${i}`);
    await Promise.all(
      providers.map((id) =>
        withModelsLock(paths, async (m) => {
          const fresh = await readModelsFile(paths);
          await new Promise((r) => setTimeout(r, 5));
          if (!fresh.providers) fresh.providers = {};
          fresh.providers[id] = {
            baseUrl: `https://api.${id}.example/v1`,
            api: "openai-completions",
            models: [{ id: `${id}-m1` }],
          };
          await import("./pi-models-port").then((mod) =>
            mod.writeModelsFile(paths, fresh),
          );
          return id;
        }),
      ),
    );
    const final = await readModelsFile(paths);
    const finalKeys = Object.keys(final.providers ?? {}).sort();
    expect(finalKeys).toEqual(providers.sort());
    expect(final.providers!["prov-3"]?.models[0]?.id).toBe("prov-3-m1");
  });
});

describe("port 之间互不阻塞 (syncProfileToPi 双锁前提)", () => {
  it("auth 锁内 await 时, models 锁仍可并发获取", async () => {
    // 同时启动两个 port 的锁, 互不阻塞; 不互踩, 各自写入各自文件
    const [, ] = await Promise.all([
      withAuthLock(paths, async (auth) => {
        auth["from-auth"] = { type: "api_key", key: "k-a" };
        // 这里 await 一下, 给 models 锁机会跑
        await new Promise((r) => setTimeout(r, 20));
        await import("./pi-auth-port").then((m) =>
          m.writeAuthFile(paths, auth),
        );
      }),
      withModelsLock(paths, async (m) => {
        if (!m.providers) m.providers = {};
        m.providers["from-models"] = {
          baseUrl: "https://x",
          api: "openai-completions",
          models: [{ id: "x" }],
        };
        await new Promise((r) => setTimeout(r, 5));
        await import("./pi-models-port").then((mod) =>
          mod.writeModelsFile(paths, m),
        );
      }),
    ]);
    const a = await readAuthFile(paths);
    const m = await readModelsFile(paths);
    expect(a["from-auth"]?.key).toBe("k-a");
    expect(m.providers?.["from-models"]?.models[0]?.id).toBe("x");
    // 物理上也分别落盘
    expect(readFileSync(paths.authPath, "utf8")).toContain("from-auth");
    expect(readFileSync(paths.modelsPath, "utf8")).toContain("from-models");
  });

  it("不同 paths 的 auth 锁互不干扰 (store-mutex 链按 path 区分)", async () => {
    const tmp2 = mkdtempSync(join(tmpdir(), "x-agent-pi-port-other-"));
    try {
      const paths2: ProviderPaths = {
        agentDir: tmp2,
        storePath: join(tmp2, "x-agent-providers.json"),
        authPath: join(tmp2, "auth.json"),
        modelsPath: join(tmp2, "models.json"),
      };
      // 同时跑两个 paths 的 auth 锁 — 不同 lockKey, 应该互不阻塞
      const [r1, r2] = await Promise.all([
        withAuthLock(paths, async (a) => {
          a["p1"] = { type: "api_key", key: "1" };
          await import("./pi-auth-port").then((m) =>
            m.writeAuthFile(paths, a),
          );
        }),
        withAuthLock(paths2, async (a) => {
          a["p2"] = { type: "api_key", key: "2" };
          await import("./pi-auth-port").then((m) =>
            m.writeAuthFile(paths2, a),
          );
        }),
      ]);
      expect(r1).toBeUndefined();
      expect(r2).toBeUndefined();
      const a1 = await readAuthFile(paths);
      const a2 = await readAuthFile(paths2);
      expect(a1["p1"]?.key).toBe("1");
      expect(a2["p2"]?.key).toBe("2");
      // 互不污染
      expect(a1["p2"]).toBeUndefined();
      expect(a2["p1"]).toBeUndefined();
    } finally {
      rmSync(tmp2, { recursive: true, force: true });
    }
  });
});
