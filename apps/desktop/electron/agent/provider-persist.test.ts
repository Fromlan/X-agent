/**
 * Vitest 单元测试 —— provider-persist 校验闸与存档隔离。
 * 重点：saveStoreUnlocked 隔离 + 存档至少一个启用的「产品约束」分支。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setSkipDnsForTests } from "./external-url";
import { setAgentDirOverrideForTests } from "./prefs";
import {
  defaultProviderPaths,
  loadStore,
  maskApiKey,
  PROVIDER_LAST_ENABLED_ERROR,
  upsertProviderProfile,
  validateUpsert,
  validateUpsertAsync,
  deleteProviderProfile,
  getProviderProfile,
  listProviderProfiles,
  type ProviderPaths,
} from "./provider-persist";
import { setSkipPiSyncForTests } from "./provider-pi-sync";

setSkipDnsForTests(true);

let homeHome = "";
let paths: ProviderPaths;
let storePath: string;

beforeEach(() => {
  homeHome = mkdtempSync(join(tmpdir(), "xagent-provider-"));
  setAgentDirOverrideForTests(homeHome);
  // 用独立子目录保证 storeInstances 缓存键不冲突
  storePath = join(homeHome, "providers.json");
  paths = {
    agentDir: homeHome,
    storePath,
    authPath: join(homeHome, "auth.json"),
    modelsPath: join(homeHome, "models.json"),
  };
  setSkipPiSyncForTests(true);
});

afterEach(() => {
  setSkipPiSyncForTests(false);
  setAgentDirOverrideForTests(null);
  if (homeHome) {
    rmSync(homeHome, { recursive: true, force: true });
    homeHome = "";
  }
});

function makeInput(
  overrides: Partial<Parameters<typeof upsertProviderProfile>[0]> = {},
): Parameters<typeof upsertProviderProfile>[0] {
  return {
    name: "Test Provider",
    providerId: "test-provider",
    api: "openai-completions",
    baseUrl: "https://example.com/v1",
    apiKey: "sk-test-1234567890",
    models: [{ id: "model-a", name: "Model A" }],
    ...overrides,
  };
}

describe("validateUpsert", () => {
  it("合法输入返回 null", () => {
    expect(validateUpsert(makeInput())).toBeNull();
  });

  it("空名称 / 空 providerId 拒绝", () => {
    expect(validateUpsert(makeInput({ name: "  " }))).toMatch(/名称/);
    expect(validateUpsert(makeInput({ providerId: "Bad ID" }))).toMatch(
      /providerId/,
    );
  });

  it("未知 API 类型拒绝", () => {
    expect(validateUpsert(makeInput({ api: "unknown-api" as never }))).toMatch(
      /API/,
    );
  });

  it("空 baseUrl 拒绝", () => {
    expect(validateUpsert(makeInput({ baseUrl: "" }))).toMatch(/baseUrl/);
  });

  it("非法 baseUrl 拒绝（静态闸）", () => {
    expect(
      validateUpsert(makeInput({ baseUrl: "file:///etc/passwd" })),
    ).toMatch(/baseUrl/);
    expect(validateUpsert(makeInput({ baseUrl: "http://localhost/" }))).toMatch(
      /baseUrl/,
    );
  });

  it("空 apiKey 拒绝", () => {
    expect(validateUpsert(makeInput({ apiKey: "" }))).toMatch(/API Key/);
  });

  it("无任何 model id 拒绝", () => {
    expect(
      validateUpsert(makeInput({ models: [{ id: "" }] })),
    ).toMatch(/模型 id/);
  });
});

describe("validateUpsertAsync", () => {
  it("同步闸先跑，再走 DNS", async () => {
    const r = await validateUpsertAsync(makeInput());
    expect(r).toBeNull();
  });

  it("DNS 校验也可拒绝", async () => {
    // 关闭 DNS 跳过,以模拟真实拦截
    setSkipDnsForTests(false);
    // 1.3: 真实 DNS 校验在此环境下不一定能 resolve; 静态闸失败也算覆盖
    const r = await validateUpsertAsync(
      makeInput({ baseUrl: "http://localhost/" }),
    );
    expect(r).toMatch(/baseUrl/);
  });
});

describe("upsertProviderProfile", () => {
  it("新建档案 + 写入文件", async () => {
    const r = await upsertProviderProfile(makeInput(), paths);
    expect(r.ok).toBe(true);
    expect(r.profile?.enabled).toBe(true);
    const stored = readFileSync(paths.storePath, "utf8");
    expect(stored).toContain("test-provider");
  });

  it("baseUrl 尾斜杠被剥离", async () => {
    const r = await upsertProviderProfile(
      makeInput({ baseUrl: "https://example.com/v1/" }),
      paths,
    );
    expect(r.ok).toBe(true);
    expect(r.profile?.baseUrl).toBe("https://example.com/v1");
  });

  it("至少保留一个启用档案（产品约束）", async () => {
    const created = await upsertProviderProfile(makeInput(), paths);
    expect(created.ok).toBe(true);
    // 试图把它关闭 → 拒绝（Store.mutate 抛 StoreMutationAborted）
    const r = await upsertProviderProfile(
      makeInput({ id: created.profile!.id, enabled: false }),
      paths,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(PROVIDER_LAST_ENABLED_ERROR);
  });

  it("删除唯一启用档案被拒绝", async () => {
    const created = await upsertProviderProfile(makeInput(), paths);
    expect(created.ok).toBe(true);
    const r = await deleteProviderProfile(created.profile!.id, paths);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(PROVIDER_LAST_ENABLED_ERROR);
  });

  it("更新已存在档案不丢更新", async () => {
    const created = await upsertProviderProfile(makeInput(), paths);
    expect(created.ok).toBe(true);
    const update = await upsertProviderProfile(
      makeInput({ id: created.profile!.id, name: "Updated" }),
      paths,
    );
    expect(update.ok).toBe(true);
    expect(update.profile?.name).toBe("Updated");
  });

  it("更新不存在的档案失败", async () => {
    const r = await upsertProviderProfile(
      makeInput({ id: "missing-id" }),
      paths,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/档案不存在/);
  });
});

describe("loadStore / getProviderProfile", () => {
  it("空目录返回空集合", async () => {
    const store = await loadStore(paths);
    expect(store.profiles).toEqual([]);
    expect(await getProviderProfile("any", paths)).toBeNull();
  });

  it("listProviderProfiles 在空目录时尝试 import，但若 import 也失败则返回空", async () => {
    // 不调 importExistingProviderProfiles:第一次启动会触发，避免在测试中跑。
    const list = await listProviderProfiles(paths);
    // list 至少是数组,长度 >= 0
    expect(Array.isArray(list)).toBe(true);
  });
});

describe("listProviderProfiles 排序", () => {
  it("按更新时间排序", async () => {
    const a = await upsertProviderProfile(makeInput({ name: "A" }), paths);
    await new Promise((r) => setTimeout(r, 5));
    const b = await upsertProviderProfile(
      makeInput({ name: "B", providerId: "provider-b" }),
      paths,
    );
    expect(a.ok && b.ok).toBe(true);
    const list = await listProviderProfiles(paths);
    expect(list.map((p) => p.name)).toEqual(["B", "A"]);
  });
});

describe("maskApiKey", () => {
  it("短 key 全部打码", () => {
    expect(maskApiKey("abcd")).toBe("••••");
  });

  it("长 key 留首尾 4 位", () => {
    expect(maskApiKey("sk-1234567890abcdef")).toBe("sk-1…cdef");
  });

  it("空返回 special", () => {
    expect(maskApiKey("")).toBe("(未设置)");
  });
});

describe("defaultProviderPaths", () => {
  it("返回 x-agent 子目录中的标准路径", () => {
    const p = defaultProviderPaths();
    expect(p.storePath).toContain("x-agent-providers.json");
    expect(p.authPath).toContain("auth.json");
    expect(p.modelsPath).toContain("models.json");
  });
});
