import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  activateProviderProfile,
  deepseekProxyModelExtras,
  deleteProviderProfile,
  getProviderProfile,
  importExistingProviderProfiles,
  isPiAutoDetectedDeepSeekEndpoint,
  listProviderPresets,
  listProviderProfiles,
  looksLikeDeepSeekModelId,
  repairDeepSeekModelsJson,
  type ProviderPaths,
  upsertProviderProfile,
} from "../electron/agent/provider-store";

const nodeRequire = createRequire(import.meta.url);

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const root = mkdtempSync(join(tmpdir(), "alpha-providers-"));
const paths: ProviderPaths = {
  agentDir: root,
  storePath: join(root, "x-agent-providers.json"),
  authPath: join(root, "auth.json"),
  modelsPath: join(root, "models.json"),
};

try {
  assert(listProviderPresets().length >= 20, "presets");
  assert(
    listProviderPresets().some((p) => p.id === "kimi" && p.category === "cn"),
    "kimi preset",
  );
  assert(
    listProviderPresets().some((p) => p.id === "openrouter"),
    "openrouter preset",
  );

  // —— 预设命名空间隔离：deepseek 与 deepseek-anthropic 必须有不同 providerId ——
  const dsPresets = listProviderPresets().filter(
    (p) => p.id === "deepseek" || p.id === "deepseek-anthropic",
  );
  assert(dsPresets.length === 2, "deepseek preset pair present");
  const dsIds = new Set(dsPresets.map((p) => p.providerId));
  assert(dsIds.size === 2, `deepseek providerIds must differ, got ${[...dsIds].join(",")}`);
  assert(
    dsPresets.find((p) => p.id === "deepseek")?.api === "openai-completions",
    "deepseek uses openai-completions",
  );
  assert(
    dsPresets.find((p) => p.id === "deepseek-anthropic")?.api === "anthropic-messages",
    "deepseek-anthropic uses anthropic-messages",
  );

  const bad = upsertProviderProfile(
    {
      name: "x",
      providerId: "x",
      api: "openai-completions",
      baseUrl: "https://example.com",
      apiKey: "sk-test",
      models: [],
    },
    paths,
  );
  assert(!bad.ok, "empty models rejected");

  const created = upsertProviderProfile(
    {
      name: "Test Relay",
      providerId: "test-relay",
      api: "openai-completions",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "sk-test-key-123456",
      models: [{ id: "model-a", name: "Model A" }],
    },
    paths,
  );
  assert(created.ok && created.profile, `create: ${created.error}`);

  const listed = listProviderProfiles(paths);
  assert(listed.length === 1 && !listed[0].active, "listed inactive");

  const act = activateProviderProfile(created.profile!.id, paths, {
    updatePrefs: false,
  });
  assert(act.ok, `activate: ${act.error}`);
  assert(act.provider === "test-relay" && act.model === "model-a", "activate ids");

  assert(existsSync(paths.authPath), "auth written");
  assert(existsSync(paths.modelsPath), "models written");
  const auth = JSON.parse(readFileSync(paths.authPath, "utf8")) as Record<
    string,
    { type: string; key: string }
  >;
  assert(auth["test-relay"]?.type === "api_key", "auth type");
  assert(auth["test-relay"]?.key === "sk-test-key-123456", "auth key");

  const models = JSON.parse(readFileSync(paths.modelsPath, "utf8")) as {
    providers: Record<string, { baseUrl: string; api: string }>;
  };
  assert(
    models.providers["test-relay"]?.baseUrl === "https://relay.example.com/v1",
    "models baseUrl",
  );

  const delActive = deleteProviderProfile(created.profile!.id, paths);
  assert(!delActive.ok, "cannot delete active");

  const other = upsertProviderProfile(
    {
      name: "Other",
      providerId: "other",
      api: "anthropic-messages",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-other-key-999",
      models: [{ id: "claude-x" }],
    },
    paths,
  );
  assert(other.ok && other.profile, "second profile");
  assert(
    activateProviderProfile(other.profile!.id, paths, { updatePrefs: false }).ok,
    "activate other",
  );
  assert(deleteProviderProfile(created.profile!.id, paths).ok, "delete inactive");

  // --- import from Pi auth/models ---
  const importRoot = mkdtempSync(join(tmpdir(), "alpha-providers-import-"));
  const importPaths: ProviderPaths = {
    agentDir: importRoot,
    storePath: join(importRoot, "x-agent-providers.json"),
    authPath: join(importRoot, "auth.json"),
    modelsPath: join(importRoot, "models.json"),
  };
  writeFileSync(
    importPaths.authPath,
    JSON.stringify({
      deepseek: { type: "api_key", key: "sk-deepseek-import-test" },
      anthropic: { type: "api_key", key: "sk-anthropic-import-test" },
    }),
    "utf8",
  );
  writeFileSync(
    importPaths.modelsPath,
    JSON.stringify({
      providers: {
        anthropic: {
          baseUrl: "https://api.deepseek.com/anthropic",
          api: "anthropic-messages",
          models: [{ id: "deepseek-v4-pro" }],
        },
      },
    }),
    "utf8",
  );
  writeFileSync(
    join(importRoot, "settings.json"),
    JSON.stringify({
      defaultProvider: "deepseek",
      defaultModel: "deepseek-v4-pro",
    }),
    "utf8",
  );

  const imported = importExistingProviderProfiles(importPaths, {
    ccSwitchDbPath: join(importRoot, "missing-cc-switch.db"),
  });
  assert(imported.ok, "import ok");
  assert(imported.imported === 2, `imported 2 got ${imported.imported}`);
  assert(imported.sources.includes("pi"), "source pi");

  const afterImport = listProviderProfiles(importPaths);
  assert(afterImport.length === 2, "listed imported");
  assert(
    afterImport.some((p) => p.providerId === "deepseek"),
    "deepseek present",
  );
  assert(
    afterImport.some((p) => p.providerId === "anthropic"),
    "anthropic present",
  );

  const again = importExistingProviderProfiles(importPaths, {
    ccSwitchDbPath: join(importRoot, "missing-cc-switch.db"),
  });
  assert(again.imported === 0 && again.skipped === 2, "dedupe on reimport");

  // --- import from cc-switch sqlite ---
  const { DatabaseSync } = nodeRequire("node:sqlite") as {
    DatabaseSync: new (path: string) => {
      exec: (sql: string) => void;
      prepare: (sql: string) => { run: (...params: unknown[]) => void };
      close: () => void;
    };
  };
  const ccDb = join(importRoot, "cc-switch.db");
  const db = new DatabaseSync(ccDb);
  db.exec(`
    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      app_type TEXT,
      name TEXT,
      settings_config TEXT,
      is_current BOOLEAN,
      icon TEXT
    );
  `);
  db.prepare(
    `INSERT INTO providers (id, app_type, name, settings_config, is_current, icon)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    "cc-1",
    "claude",
    "Lingya",
    JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: "sk-lingya-from-cc",
        ANTHROPIC_BASE_URL: "https://api.lingyaai.cn",
        ANTHROPIC_MODEL: "claude-sonnet",
      },
    }),
    1,
    "lingya",
  );
  db.prepare(
    `INSERT INTO providers (id, app_type, name, settings_config, is_current, icon)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    "cc-2",
    "claude-desktop",
    "Lingya",
    JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: "sk-lingya-from-cc",
        ANTHROPIC_BASE_URL: "https://api.lingyaai.cn",
      },
    }),
    0,
    "lingya",
  );
  db.close();

  const fromCc = importExistingProviderProfiles(importPaths, {
    ccSwitchDbPath: ccDb,
  });
  assert(fromCc.ok, "cc import ok");
  assert(fromCc.imported === 1, `cc imported 1 got ${fromCc.imported}`);
  assert(fromCc.sources.includes("cc-switch"), "source cc-switch");
  assert(
    listProviderProfiles(importPaths).some((p) => p.name === "Lingya"),
    "lingya listed",
  );

  // —— 激活 deepseek-anthropic 不应覆盖 Pi auth/models 中已存在的 deepseek openai key ——
  const nsRoot = mkdtempSync(join(tmpdir(), "alpha-providers-ns-"));
  const nsPaths: ProviderPaths = {
    agentDir: nsRoot,
    storePath: join(nsRoot, "x-agent-providers.json"),
    authPath: join(nsRoot, "auth.json"),
    modelsPath: join(nsRoot, "models.json"),
  };
  // 已有 deepseek (openai) 与 deepseek-anthropic 两条 Pi 配置
  writeFileSync(
    nsPaths.authPath,
    JSON.stringify({
      deepseek: { type: "api_key", key: "sk-ds-openai-key" },
      "deepseek-anthropic": { type: "api_key", key: "sk-ds-anthropic-key" },
    }),
    "utf8",
  );
  writeFileSync(
    nsPaths.modelsPath,
    JSON.stringify({
      providers: {
        deepseek: {
          baseUrl: "https://api.deepseek.com",
          api: "openai-completions",
          models: [{ id: "deepseek-chat" }],
        },
        "deepseek-anthropic": {
          baseUrl: "https://api.deepseek.com/anthropic",
          api: "anthropic-messages",
          models: [{ id: "deepseek-v4-pro" }],
        },
      },
    }),
    "utf8",
  );

  const nsImported = importExistingProviderProfiles(nsPaths, {
    ccSwitchDbPath: join(nsRoot, "missing-cc-switch.db"),
  });
  assert(nsImported.ok, "ns import ok");
  assert(nsImported.imported === 2, `ns imported 2 got ${nsImported.imported}`);

  const dsAnthropicProfile = listProviderProfiles(nsPaths).find(
    (p) => p.providerId === "deepseek-anthropic",
  );
  assert(dsAnthropicProfile, "deepseek-anthropic profile exists");

  const dsAnthropicFull = getProviderProfile(dsAnthropicProfile!.id, nsPaths);
  assert(dsAnthropicFull, "fetch deepseek-anthropic full profile");
  const dsAnthropicAct = activateProviderProfile(
    dsAnthropicFull!.id,
    nsPaths,
    { updatePrefs: false },
  );
  assert(dsAnthropicAct.ok, `activate deepseek-anthropic: ${dsAnthropicAct.error}`);

  const nsAuth = JSON.parse(readFileSync(nsPaths.authPath, "utf8")) as Record<
    string,
    { type: string; key: string }
  >;
  // 关键断言：两条 key 应同时存在
  assert(
    nsAuth["deepseek"]?.key === "sk-ds-openai-key",
    "deepseek openai key preserved",
  );
  assert(
    nsAuth["deepseek-anthropic"]?.key === "sk-ds-anthropic-key",
    "deepseek-anthropic key written",
  );

  const nsModels = JSON.parse(readFileSync(nsPaths.modelsPath, "utf8")) as {
    providers: Record<string, { api: string; baseUrl: string }>;
  };
  assert(
    nsModels.providers["deepseek"]?.api === "openai-completions",
    "deepseek models.json api preserved",
  );
  assert(
    nsModels.providers["deepseek-anthropic"]?.api === "anthropic-messages",
    "deepseek-anthropic models.json api written",
  );

  // —— slugifyProviderId 对纯中文/emoji 应安全回退 ——
  const slugProbe = mkdtempSync(join(tmpdir(), "alpha-providers-slug-"));
  const slugPaths: ProviderPaths = {
    agentDir: slugProbe,
    storePath: join(slugProbe, "x-agent-providers.json"),
    authPath: join(slugProbe, "auth.json"),
    modelsPath: join(slugProbe, "models.json"),
  };
  // 准备 Pi auth/models 让 cc-switch 路径不可达，触发 slugifyProviderId(icon|name, fallback)
  // 通过直接调用 upsertProviderProfile 校验 providerId 校验：纯中文 providerId 应被拒绝。
  const cnUpsert = upsertProviderProfile(
    {
      name: "中文名",
      providerId: "中文",
      api: "openai-completions",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-cn",
      models: [{ id: "m" }],
    },
    slugPaths,
  );
  assert(!cnUpsert.ok, "pure CJK providerId rejected");

  // 纯 emoji 同样应被拒绝（不合法 providerId）。
  const emojiUpsert = upsertProviderProfile(
    {
      name: "Emoji",
      providerId: "🚀",
      api: "openai-completions",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-emoji",
      models: [{ id: "m" }],
    },
    slugPaths,
  );
  assert(!emojiUpsert.ok, "emoji-only providerId rejected");

  rmSync(slugProbe, { recursive: true, force: true });
  rmSync(nsRoot, { recursive: true, force: true });

  rmSync(importRoot, { recursive: true, force: true });

  // —— 代理 DeepSeek：models.json 应写入 deepseek compat ——
  assert(looksLikeDeepSeekModelId("deepseek-ai/DeepSeek-V3"), "looksLike V3");
  assert(!looksLikeDeepSeekModelId("Qwen/Qwen3"), "not qwen");
  assert(
    isPiAutoDetectedDeepSeekEndpoint("deepseek", "https://api.deepseek.com"),
    "official deepseek auto",
  );
  assert(
    !isPiAutoDetectedDeepSeekEndpoint(
      "siliconflow",
      "https://api.siliconflow.cn/v1",
    ),
    "siliconflow not auto",
  );
  assert(
    deepseekProxyModelExtras("deepseek-ai/DeepSeek-V3")?.compat
      .thinkingFormat === "deepseek",
    "proxy extras thinkingFormat",
  );
  assert(
    deepseekProxyModelExtras("deepseek-v4-pro[1M]")?.reasoning === true,
    "v4 custom id gets reasoning",
  );
  assert(
    deepseekProxyModelExtras("deepseek-v4-pro[1M]")?.thinkingLevelMap
      ?.medium === null,
    "v4 custom id hides medium",
  );

  const proxyRoot = mkdtempSync(join(tmpdir(), "alpha-providers-proxy-ds-"));
  const proxyPaths: ProviderPaths = {
    agentDir: proxyRoot,
    storePath: join(proxyRoot, "x-agent-providers.json"),
    authPath: join(proxyRoot, "auth.json"),
    modelsPath: join(proxyRoot, "models.json"),
  };
  const proxyCreated = upsertProviderProfile(
    {
      name: "SF",
      providerId: "siliconflow",
      api: "openai-completions",
      baseUrl: "https://api.siliconflow.cn/v1",
      apiKey: "sk-sf-test",
      models: [
        { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3" },
        { id: "Qwen/Qwen3-235B-A22B", name: "Qwen3" },
      ],
    },
    proxyPaths,
  );
  assert(proxyCreated.ok && proxyCreated.profile, "proxy profile");
  assert(
    activateProviderProfile(proxyCreated.profile!.id, proxyPaths, {
      updatePrefs: false,
    }).ok,
    "activate proxy",
  );
  const proxyModels = JSON.parse(readFileSync(proxyPaths.modelsPath, "utf8")) as {
    providers: Record<
      string,
      {
        models: Array<{
          id: string;
          reasoning?: boolean;
          compat?: { thinkingFormat?: string };
        }>;
      }
    >;
  };
  const sfModels = proxyModels.providers["siliconflow"]?.models ?? [];
  const dsEntry = sfModels.find((m) => m.id === "deepseek-ai/DeepSeek-V3");
  const qwenEntry = sfModels.find((m) => m.id === "Qwen/Qwen3-235B-A22B");
  assert(dsEntry?.reasoning === true, "proxy deepseek reasoning");
  assert(
    dsEntry?.compat?.thinkingFormat === "deepseek",
    "proxy deepseek compat",
  );
  assert(
    (dsEntry as { contextWindow?: number } | undefined)?.contextWindow ===
      128_000,
    "proxy deepseek contextWindow V3",
  );
  assert(qwenEntry?.compat == null, "qwen without deepseek compat");

  // DeepSeek V4 preset activate should write 1M contextWindow
  const v4 = upsertProviderProfile(
    {
      name: "DS V4",
      providerId: "deepseek",
      api: "openai-completions",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-ds-v4",
      models: [{ id: "deepseek-v4-flash", name: "Flash" }],
    },
    proxyPaths,
  );
  assert(v4.ok && v4.profile, "v4 profile");
  assert(
    v4.profile!.models[0]?.contextWindow === 1_000_000,
    "upsert enriches v4 context",
  );
  assert(
    activateProviderProfile(v4.profile!.id, proxyPaths, {
      updatePrefs: false,
    }).ok,
    "activate v4",
  );
  const v4Models = JSON.parse(readFileSync(proxyPaths.modelsPath, "utf8")) as {
    providers: Record<
      string,
      { models: Array<{ id: string; contextWindow?: number }> }
    >;
  };
  assert(
    v4Models.providers["deepseek"]?.models?.[0]?.contextWindow === 1_000_000,
    "models.json contextWindow for v4",
  );

  // 官方 deepseek.com：依赖 Pi 自动检测，不重复写 compat
  const official = upsertProviderProfile(
    {
      name: "DS Official",
      providerId: "deepseek",
      api: "openai-completions",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-ds-official",
      models: [{ id: "deepseek-v4-flash", name: "Flash" }],
    },
    proxyPaths,
  );
  assert(official.ok && official.profile, "official profile");
  assert(
    activateProviderProfile(official.profile!.id, proxyPaths, {
      updatePrefs: false,
    }).ok,
    "activate official",
  );
  const officialModels = JSON.parse(
    readFileSync(proxyPaths.modelsPath, "utf8"),
  ) as {
    providers: Record<
      string,
      {
        models: Array<{
          id: string;
          reasoning?: boolean;
          thinkingLevelMap?: Record<string, string | null>;
          compat?: unknown;
        }>;
      }
    >;
  };
  const officialEntry = officialModels.providers["deepseek"]?.models?.[0];
  assert(officialEntry?.compat == null, "official deepseek skips written compat");
  assert(officialEntry?.reasoning === true, "official deepseek writes reasoning");
  assert(
    officialEntry?.thinkingLevelMap?.medium === null,
    "official v4 writes thinkingLevelMap",
  );

  // repairDeepSeekModelsJson upgrades legacy entries missing reasoning
  const legacyRoot = mkdtempSync(join(tmpdir(), "alpha-providers-repair-ds-"));
  const legacyPaths: ProviderPaths = {
    agentDir: legacyRoot,
    storePath: join(legacyRoot, "x-agent-providers.json"),
    authPath: join(legacyRoot, "auth.json"),
    modelsPath: join(legacyRoot, "models.json"),
  };
  writeFileSync(
    legacyPaths.modelsPath,
    JSON.stringify(
      {
        providers: {
          deepseek: {
            baseUrl: "https://api.deepseek.com",
            api: "openai-completions",
            models: [{ id: "deepseek-v4-pro[1M]", name: "Pro 1M" }],
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  assert(repairDeepSeekModelsJson(legacyPaths), "repair writes");
  assert(!repairDeepSeekModelsJson(legacyPaths), "repair idempotent");
  const repaired = JSON.parse(readFileSync(legacyPaths.modelsPath, "utf8")) as {
    providers: Record<
      string,
      {
        models: Array<{
          id: string;
          reasoning?: boolean;
          thinkingLevelMap?: Record<string, string | null>;
        }>;
      }
    >;
  };
  const repairedEntry = repaired.providers.deepseek?.models?.[0];
  assert(repairedEntry?.reasoning === true, "repair sets reasoning");
  assert(
    repairedEntry?.thinkingLevelMap?.medium === null,
    "repair sets v4 map",
  );
  rmSync(legacyRoot, { recursive: true, force: true });

  rmSync(proxyRoot, { recursive: true, force: true });

  console.log("test-provider-store: ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}
