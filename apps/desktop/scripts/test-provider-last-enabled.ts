import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteProviderProfile,
  filterModelsByCatalogEnabled,
  setProviderProfileEnabled,
  upsertProviderProfile,
  type ProviderPaths,
} from "../electron/agent/provider-store";
import { pruneProviderIdFromPi } from "../electron/agent/provider-pi-sync";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const root = mkdtempSync(join(tmpdir(), "alpha-providers-last-enabled-"));
const paths: ProviderPaths = {
  agentDir: root,
  storePath: join(root, "x-agent-providers.json"),
  authPath: join(root, "auth.json"),
  modelsPath: join(root, "models.json"),
};

try {
  void (async () => {
    // —— 场景 A: 唯一启用档案不能被关闭 ——
    const only = await upsertProviderProfile(
      {
        name: "Only",
        providerId: "only",
        api: "openai-completions",
        baseUrl: "https://only.example.com/v1",
        apiKey: "sk-only-123456",
        models: [{ id: "model-only" }],
      },
      paths,
    );
    assert(only.ok && only.profile, `create only: ${only.error}`);
    const offLast = await setProviderProfileEnabled(only.profile!.id, false, paths);
    assert(!offLast.ok, "disable last enabled must fail");
    assert(
      typeof offLast.error === "string" && offLast.error.includes("至少保留一个"),
      `error message hints at least-one: ${offLast.error}`,
    );
    // 状态未被破坏。
    const stillEnabled = await setProviderProfileEnabled(only.profile!.id, true, paths);
    assert(stillEnabled.ok, "no-op re-enable must succeed");

    // —— 场景 B: 删除唯一启用档案被拒绝 ——
    const delLast = await deleteProviderProfile(only.profile!.id, paths);
    assert(!delLast.ok, "delete last enabled must fail");
    assert(
      typeof delLast.error === "string" && delLast.error.includes("至少保留一个"),
      `delete error hints at least-one: ${delLast.error}`,
    );
    // 档案仍在 catalog。
    const stillThere = await filterModelsByCatalogEnabled(
      [{ provider: "only", id: "model-only" }],
      paths,
    );
    assert(stillThere.length === 1, "catalog entry preserved after rejected delete");

    // —— 场景 C: 两个启用档案,关掉一个允许 ——
    const second = await upsertProviderProfile(
      {
        name: "Second",
        providerId: "second",
        api: "openai-completions",
        baseUrl: "https://second.example.com/v1",
        apiKey: "sk-second-123456",
        models: [{ id: "model-second" }],
      },
      paths,
    );
    assert(second.ok && second.profile, `create second: ${second.error}`);
    const offOneOfTwo = await setProviderProfileEnabled(only.profile!.id, false, paths);
    assert(offOneOfTwo.ok, "disable one of two must succeed");
    // 第二条仍启用,过滤后只剩它的模型。
    const filteredTwo = await filterModelsByCatalogEnabled(
      [
        { provider: "only", id: "model-only" },
        { provider: "second", id: "model-second" },
        { provider: "openai", id: "gpt-4o" },
      ],
      paths,
    );
    const providers = new Set(filteredTwo.map((m) => m.provider));
    assert(providers.has("second"), "second model visible");
    assert(!providers.has("only"), "first model hidden");
    assert(providers.has("openai"), "unmanaged provider passthrough");

    // —— 场景 D: 编辑表单把唯一启用档案改为 disabled 也要被拒绝 ——
    const offByUpsert = await upsertProviderProfile(
      {
        id: second.profile!.id,
        name: "Second",
        providerId: "second",
        api: "openai-completions",
        baseUrl: "https://second.example.com/v1",
        apiKey: "sk-second-123456",
        models: [{ id: "model-second" }],
        enabled: false,
      },
      paths,
    );
    assert(!offByUpsert.ok, "upsert-enabled=false on last enabled must fail");
    assert(
      typeof offByUpsert.error === "string" &&
        offByUpsert.error.includes("至少保留一个"),
      `upsert error hints at least-one: ${offByUpsert.error}`,
    );

    // —— 场景 E: 关掉之后再恢复,过滤集合回到全集 ——
    const restore = await setProviderProfileEnabled(only.profile!.id, true, paths);
    assert(restore.ok, "re-enable previously-disabled must succeed");
    const filteredAll = await filterModelsByCatalogEnabled(
      [
        { provider: "only", id: "model-only" },
        { provider: "second", id: "model-second" },
      ],
      paths,
    );
    assert(filteredAll.length === 2, "both visible after restore");

    // —— 场景 F: providerId 拼写漂移(老版本给同 baseUrl 加了 "-2")的兜底 ——
  // catalog 档案 providerId = "ds-stale",但 Pi 端仍按旧 key "DeepSeek"
  // 暴露模型。关掉 catalog 档案后,Pi 端应被 prune,且 TopBar 不再展示。
  {
    const driftRoot = mkdtempSync(join(tmpdir(), "alpha-providers-drift-"));
    const driftPaths: ProviderPaths = {
      agentDir: driftRoot,
      storePath: join(driftRoot, "x-agent-providers.json"),
      authPath: join(driftRoot, "auth.json"),
      modelsPath: join(driftRoot, "models.json"),
    };
    // 预置 Pi auth/models:key 是 "DeepSeek"(老拼写),但 baseUrl 与档案一致。
    const { writeFileSync, readFileSync } = await import("node:fs");
    writeFileSync(
      driftPaths.authPath,
      JSON.stringify({
        DeepSeek: { type: "api_key", key: "sk-drift-123456" },
      }),
      "utf8",
    );
    writeFileSync(
      driftPaths.modelsPath,
      JSON.stringify({
        providers: {
          DeepSeek: {
            baseUrl: "https://api.deepseek.com/anthropic",
            api: "anthropic-messages",
            models: [{ id: "deepseek-v4-pro" }],
          },
        },
      }),
      "utf8",
    );
    // 先加一条常驻档案,避免触发"至少保留一个启用档案"约束。
    const always = await upsertProviderProfile(
      {
        name: "Always On",
        providerId: "always-on",
        api: "anthropic-messages",
        baseUrl: "https://always.example.com/v1",
        apiKey: "sk-always-123456",
        models: [{ id: "always-model" }],
      },
      driftPaths,
    );
    assert(always.ok, `always-on: ${always.error}`);
    // 档案在 catalog 中写成 "ds-stale",模拟历史 import 拼写漂移。
    const drifted = await upsertProviderProfile(
      {
        name: "DeepSeek Drifted",
        providerId: "ds-stale",
        api: "anthropic-messages",
        baseUrl: "https://api.deepseek.com/anthropic",
        apiKey: "sk-drift-123456",
        models: [{ id: "deepseek-v4-pro" }],
      },
      driftPaths,
    );
    assert(drifted.ok && drifted.profile, "drifted create");

    // 关掉 catalog 档案 → prune 应通过 baseUrl 兜底删除 Pi 端 "DeepSeek"。
    const off = await setProviderProfileEnabled(
      drifted.profile!.id,
      false,
      driftPaths,
    );
    assert(off.ok, `disable drifted: ${off.error}`);
    const modelsAfter = JSON.parse(
      readFileSync(driftPaths.modelsPath, "utf8"),
    ) as { providers: Record<string, unknown> };
    assert(
      !("DeepSeek" in modelsAfter.providers),
      "Pi 'DeepSeek' pruned via baseUrl fallback",
    );

    // 同时直接调用 prune 也应兼容(需先把档案 disable,否则 prune 早返回)。
    await setProviderProfileEnabled(drifted.profile!.id, false, driftPaths);
    // 重新写入 Pi 让 "DeepSeek" 回来。
    writeFileSync(
      driftPaths.modelsPath,
      JSON.stringify({
        providers: {
          DeepSeek: {
            baseUrl: "https://api.deepseek.com/anthropic",
            api: "anthropic-messages",
            models: [{ id: "deepseek-v4-pro" }],
          },
        },
      }),
      "utf8",
    );
    await pruneProviderIdFromPi("ds-stale", driftPaths);
    const modelsPruned = JSON.parse(
      readFileSync(driftPaths.modelsPath, "utf8"),
    ) as { providers: Record<string, unknown> };
    assert(
      !("DeepSeek" in modelsPruned.providers),
      "pruneProviderIdFromPi also prunes by baseUrl fallback",
    );

    // filterModelsByCatalogEnabled:即使 Pi 仍按旧 key 暴露模型(假设 prune 未跑),
    // baseUrl 兜底也应正确隐藏。
    writeFileSync(
      driftPaths.modelsPath,
      JSON.stringify({
        providers: {
          DeepSeek: {
            baseUrl: "https://api.deepseek.com/anthropic",
            api: "anthropic-messages",
            models: [{ id: "deepseek-v4-pro" }],
          },
        },
      }),
      "utf8",
    );
    const filtered = await filterModelsByCatalogEnabled(
      [
        {
          provider: "DeepSeek",
          id: "deepseek-v4-pro",
          baseUrl: "https://api.deepseek.com/anthropic",
        },
        {
          provider: "OtherOAuth",
          id: "oauth-1",
          baseUrl: "https://oauth.example.com",
        },
      ],
      driftPaths,
    );
    const visibleProviders = new Set(filtered.map((m) => m.provider));
    assert(
      !visibleProviders.has("DeepSeek"),
      "filter hides Pi 'DeepSeek' whose baseUrl matches disabled catalog",
    );
    assert(
      visibleProviders.has("OtherOAuth"),
      "filter keeps unmanaged OAuth builtin passthrough",
    );

    rmSync(driftRoot, { recursive: true, force: true });
  }

    console.log("test-provider-last-enabled: ok");
  })().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}