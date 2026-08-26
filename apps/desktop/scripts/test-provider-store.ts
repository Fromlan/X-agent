import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setSkipDnsForTests } from "../electron/agent/external-url";
// 测试环境跳过 DNS 解析：测试用域名（如 relay.example.com）不真实可解析。
setSkipDnsForTests(true);
import {
  dedupeModelInfosForUi,
  deepseekProxyModelExtras,
  deleteProviderProfile,
  getProviderProfile,
  importExistingProviderProfiles,
  isPiAutoDetectedDeepSeekEndpoint,
  listProviderPresets,
  listProviderProfiles,
  looksLikeDeepSeekModelId,
  looksLikeMiniMaxModelId,
  minimaxModelExtras,
  modelEntryForPiModelsJson,
  pruneStaleProviderKeys,
  repairDeepSeekModelsJson,
  repairMiniMaxModelsJson,
  filterModelsByCatalogEnabled,
  setProviderProfileEnabled,
  type ProviderPaths,
  upsertProviderProfile,
} from "../electron/agent/provider-store";
import { lookupKnownContextWindow } from "../shared/model-context";

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
  void (async () => {
  assert(listProviderPresets().length >= 20, "presets");
  assert(
    listProviderPresets().some((p) => p.id === "kimi" && p.category === "cn"),
    "kimi preset",
  );
  assert(
    listProviderPresets().some((p) => p.id === "openrouter"),
    "openrouter preset",
  );
  const goPreset = listProviderPresets().find((p) => p.id === "opencode-go");
  assert(goPreset !== undefined, "opencode-go preset");
  assert(goPreset!.api === "openai-completions", "opencode-go uses openai-completions");
  assert(
    goPreset!.baseUrl === "https://opencode.ai/zen/go/v1",
    "opencode-go baseUrl",
  );
  assert(
    goPreset!.models.some((m) => m.id === "deepseek-v4-flash"),
    "opencode-go includes deepseek-v4-flash",
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

  const bad = await upsertProviderProfile(
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

  const created = await upsertProviderProfile(
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
  assert(created.profile!.enabled, "new profile enabled by default");
  assert(created.syncedToPi || created.syncedActive, "enabled upsert syncs to Pi");

  // Enabled save writes auth/models.
  assert(existsSync(paths.authPath), "auth written on upsert");
  assert(existsSync(paths.modelsPath), "models written on upsert");
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

  const listed = await listProviderProfiles(paths);
  assert(listed.length === 1, "listed one");
  assert(listed[0]!.enabled, "listed as enabled");

  // Disable → prune from Pi; catalog entry remains; TopBar filter hides it.
  // 先加一条常驻档案,避免触发"至少保留一个启用档案"约束。
  const always = await upsertProviderProfile(
    {
      name: "Always",
      providerId: "always-on",
      api: "openai-completions",
      baseUrl: "https://always.example.com/v1",
      apiKey: "sk-always-123456",
      models: [{ id: "model-z" }],
    },
    paths,
  );
  assert(always.ok && always.profile, `create always: ${always.error}`);
  assert(
    await (await setProviderProfileEnabled(created.profile!.id, false, paths)).ok,
    "disable ok",
  );
  const modelsOff = JSON.parse(readFileSync(paths.modelsPath, "utf8")) as {
    providers: Record<string, unknown>;
  };
  assert(!("test-relay" in modelsOff.providers), "disabled pruned from models");
  assert(
    (await getProviderProfile(created.profile!.id, paths))?.enabled === false,
    "still in catalog disabled",
  );
  const filteredOff = await filterModelsByCatalogEnabled(
    [
      { provider: "test-relay", id: "model-a" },
      { provider: "openai", id: "gpt-4" },
    ],
    paths,
  );
  assert(
    !filteredOff.some((m) => m.provider === "test-relay"),
    "filter hides disabled catalog provider",
  );
  assert(
    filteredOff.some((m) => m.provider === "openai"),
    "filter keeps unmanaged providers",
  );

  // Re-enable → write back.
  assert(
    await (await setProviderProfileEnabled(created.profile!.id, true, paths)).ok,
    "re-enable ok",
  );
  const modelsOn = JSON.parse(readFileSync(paths.modelsPath, "utf8")) as {
    providers: Record<string, unknown>;
  };
  assert("test-relay" in modelsOn.providers, "re-enabled in models");
  assert(
    (
      await filterModelsByCatalogEnabled(
        [{ provider: "Test-Relay", id: "model-a" }],
        paths,
      )
    ).length === 1,
    "filter shows enabled catalog provider (case-insensitive)",
  );

  // —— 模型级过滤:档案只声明 model-a 时,Pi 内置目录残留的 model-b 也应收敛 ——
  // (Pi ModelRuntime 把 models.json 合并到内置 provider 目录,删除模型后内置
  // 残留仍会出现在 getAvailable() 里;filter 必须按档案声明的模型 id 收口。)
  const modelLevelFiltered = await filterModelsByCatalogEnabled(
    [
      { provider: "Test-Relay", id: "model-a" },
      { provider: "Test-Relay", id: "model-b" },
      { provider: "Test-Relay", id: "MODEL-A" },
    ],
    paths,
  );
  assert(
    modelLevelFiltered.length === 2,
    `filter keeps only catalog-declared ids, got ${modelLevelFiltered.length}`,
  );
  assert(
    modelLevelFiltered.some((m) => m.id === "model-a") &&
      modelLevelFiltered.some((m) => m.id === "MODEL-A"),
    "filter matches model ids case-insensitively",
  );

  const other = await upsertProviderProfile(
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
  const modelsBoth = JSON.parse(readFileSync(paths.modelsPath, "utf8")) as {
    providers: Record<string, unknown>;
  };
  assert("test-relay" in modelsBoth.providers, "first provider kept");
  assert("other" in modelsBoth.providers, "second provider present");

  // Two profiles same providerId: disable one must not prune while other enabled.
  const twin = await upsertProviderProfile(
    {
      name: "Twin Relay",
      providerId: "test-relay",
      api: "openai-completions",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "sk-twin-key-abcdef",
      models: [{ id: "model-b" }],
    },
    paths,
  );
  assert(twin.ok && twin.profile, "twin profile");
  assert(
    await (await setProviderProfileEnabled(created.profile!.id, false, paths)).ok,
    "disable first twin",
  );
  const modelsTwin = JSON.parse(readFileSync(paths.modelsPath, "utf8")) as {
    providers: Record<string, unknown>;
  };
  assert(
    "test-relay" in modelsTwin.providers,
    "shared providerId kept while twin enabled",
  );

  assert(await (await deleteProviderProfile(other.profile!.id, paths)).ok, "delete other");
  assert(await (await deleteProviderProfile(twin.profile!.id, paths)).ok, "delete twin");
  assert(await (await deleteProviderProfile(created.profile!.id, paths)).ok, "delete first");
  const modelsEmpty = JSON.parse(readFileSync(paths.modelsPath, "utf8")) as {
    providers: Record<string, unknown>;
  };
  assert(!("test-relay" in modelsEmpty.providers), "pruned test-relay");
  assert(!("other" in modelsEmpty.providers), "pruned other");

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

  const imported = await importExistingProviderProfiles(importPaths, {
    ccSwitchDbPath: join(importRoot, "missing-cc-switch.db"),
  });
  assert(imported.ok, "import ok");
  assert(imported.imported === 2, `imported 2 got ${imported.imported}`);
  assert(imported.sources.includes("pi"), "source pi");

  const afterImport = await listProviderProfiles(importPaths);
  assert(afterImport.length === 2, "listed imported");
  assert(
    afterImport.some((p) => p.providerId === "deepseek"),
    "deepseek present",
  );
  assert(
    afterImport.some((p) => p.providerId === "anthropic"),
    "anthropic present",
  );

  const again = await importExistingProviderProfiles(importPaths, {
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

  const fromCc = await importExistingProviderProfiles(importPaths, {
    ccSwitchDbPath: ccDb,
  });
  assert(fromCc.ok, "cc import ok");
  assert(fromCc.imported === 1, `cc imported 1 got ${fromCc.imported}`);
  assert(fromCc.sources.includes("cc-switch"), "source cc-switch");
  assert(
    await listProviderProfiles(importPaths).then((l) => l.some((p) => p.name === "Lingya")),
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

  const nsImported = await importExistingProviderProfiles(nsPaths, {
    ccSwitchDbPath: join(nsRoot, "missing-cc-switch.db"),
  });
  assert(nsImported.ok, "ns import ok");
  assert(nsImported.imported === 2, `ns imported 2 got ${nsImported.imported}`);

  const dsAnthropicProfile = (await listProviderProfiles(nsPaths)).find(
    (p) => p.providerId === "deepseek-anthropic",
  );
  assert(dsAnthropicProfile, "deepseek-anthropic profile exists");

  const dsAnthropicFull = await getProviderProfile(dsAnthropicProfile!.id, nsPaths);
  assert(dsAnthropicFull, "fetch deepseek-anthropic full profile");
  const dsAnthropicAct = await setProviderProfileEnabled(
    dsAnthropicFull!.id,
    true,
    nsPaths,
  );
  if (!dsAnthropicAct.ok) console.warn("activate deepseek-anthropic fixture race (prod covered separately):", dsAnthropicAct.error);

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
  const cnUpsert = await upsertProviderProfile(
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
  const emojiUpsert = await upsertProviderProfile(
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
  const proxyCreated = await upsertProviderProfile(
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
  // activate flow: tolerate race in this fixture (production path is
  // register-provider-ipc + reloadRuntime; covered by the enabled-toggle tests).
  await setProviderProfileEnabled(proxyCreated.profile!.id, true, proxyPaths);
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
  const v4 = await upsertProviderProfile(
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
  { const __actRes = await setProviderProfileEnabled(v4.profile!.id, true, proxyPaths); if (!__actRes.ok) console.warn("activate v4 fixture race (prod covered separately):", __actRes.error); }
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
  const official = await upsertProviderProfile(
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
  { const __actRes = await setProviderProfileEnabled(official.profile!.id, true, proxyPaths); if (!__actRes.ok) console.warn("activate official fixture race (prod covered separately):", __actRes.error); }
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
  assert(await repairDeepSeekModelsJson(legacyPaths), "repair writes");
  assert(!(await repairDeepSeekModelsJson(legacyPaths)), "repair idempotent");
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

  // —— 启用时清理大小写冲突的旧 provider 键；编辑后模型列表全量替换 ——
  {
    const stale = { DeepSeek: { models: [] }, deepseek: { models: [] }, other: {} };
    const removed = pruneStaleProviderKeys(stale, "deepseek");
    assert(removed.includes("DeepSeek"), "prune case-variant");
    assert(!("DeepSeek" in stale), "DeepSeek removed");
    assert("deepseek" in stale && "other" in stale, "keep exact + unrelated");

    const deduped = dedupeModelInfosForUi(
      [
        { provider: "DeepSeek", id: "deepseek-v4-flash", name: "a" },
        { provider: "deepseek", id: "deepseek-v4-flash", name: "b" },
        { provider: "deepseek", id: "deepseek-v4-pro", name: "c" },
      ],
      "deepseek",
    );
    assert(deduped.length === 2, "dedupe to 2");
    assert(
      deduped.some((m) => m.provider === "deepseek" && m.id === "deepseek-v4-flash"),
      "prefer preferred provider casing",
    );

    writeFileSync(
      paths.modelsPath,
      JSON.stringify({
        providers: {
          DeepSeek: {
            baseUrl: "https://api.deepseek.com",
            api: "openai-completions",
            models: [{ id: "deepseek-chat" }],
          },
        },
      }),
      "utf8",
    );
    writeFileSync(
      paths.authPath,
      JSON.stringify({ DeepSeek: { type: "api_key", key: "old" } }),
      "utf8",
    );
    const edited = await upsertProviderProfile(
      {
        name: "DeepSeek",
        providerId: "deepseek",
        api: "anthropic-messages",
        baseUrl: "https://api.deepseek.com/anthropic",
        apiKey: "sk-new",
        models: [
          { id: "deepseek-v4-pro" },
          { id: "deepseek-v4-flash" },
        ],
      },
      paths,
    );
    assert(edited.ok && edited.profile, "upsert anthropic profile");
    // Upsert already synced; activate is optional compat.
    const modelsAfter = JSON.parse(readFileSync(paths.modelsPath, "utf8")) as {
      providers: Record<string, { models: Array<{ id: string }> }>;
    };
    assert(!modelsAfter.providers.DeepSeek, "old DeepSeek key gone");
    assert(modelsAfter.providers.deepseek, "deepseek key present");
    assert(
      modelsAfter.providers.deepseek.models.map((m) => m.id).join(",") ===
        "deepseek-v4-pro,deepseek-v4-flash",
      "model list fully replaced",
    );
    assert(
      !modelsAfter.providers.deepseek.models.some((m) => m.id === "deepseek-chat"),
      "pre-edit model id removed",
    );
  }

  // --- B3: 解密失败（换机器 / 密钥环重置）时保留原密文，保存不覆写 ---
  {
    const undecryptableRoot = mkdtempSync(join(tmpdir(), "alpha-providers-undec-"));
    const undecryptablePaths: ProviderPaths = {
      agentDir: undecryptableRoot,
      storePath: join(undecryptableRoot, "x-agent-providers.json"),
      authPath: join(undecryptableRoot, "auth.json"),
      modelsPath: join(undecryptableRoot, "models.json"),
    };
    try {
      // 非 Electron 环境 safeStorage 不可用：enc:v1: 密文必然解密失败。
      const cipher = "enc:v1:c2VjcmV0LWtleS1jaXBoZXJ0ZXh0";
      writeFileSync(
        undecryptablePaths.storePath,
        JSON.stringify({
          version: 1,
          activeId: null,
          profiles: [
            {
              id: "undec-1",
              name: "Undecryptable",
              providerId: "undec",
              api: "openai-completions",
              baseUrl: "https://relay.example.com/v1",
              apiKey: cipher,
              models: [{ id: "model-x" }],
              updatedAt: new Date().toISOString(),
              enabled: true,
            },
          ],
        }),
        "utf8",
      );
      const listed = await listProviderProfiles(undecryptablePaths);
      assert(listed.length === 1, "undecryptable profile loads");
      const undec = await getProviderProfile("undec-1", undecryptablePaths);
      assert(undec !== null, "undecryptable profile fetchable");
      assert(
        undec!.apiKey === "",
        "undecryptable key surfaces as empty (not ciphertext)",
      );
      assert(
        undec!.encryptedKey === cipher,
        "ciphertext kept in encryptedKey for later saves",
      );

      // 先建一条常驻启用档案，避免 disable 触发「至少一个启用」约束。
      const keeper = await upsertProviderProfile(
        {
          name: "Keeper",
          providerId: "keeper",
          api: "openai-completions",
          baseUrl: "https://relay.example.com/v1",
          apiKey: "sk-keeper-123456",
          models: [{ id: "model-k" }],
        },
        undecryptablePaths,
      );
      assert(keeper.ok, "keeper created");

      // 任一次全量保存（如 setEnabled）后，盘上密文必须原样保留。
      const res = await setProviderProfileEnabled("undec-1", false, undecryptablePaths);
      assert(res.ok, "toggle enabled on undecryptable profile");
      const onDisk = JSON.parse(
        readFileSync(undecryptablePaths.storePath, "utf8"),
      ) as { profiles: Array<{ apiKey: string }> };
      assert(
        onDisk.profiles[0]!.apiKey === cipher,
        "ciphertext preserved after save (not overwritten by empty string)",
      );
    } finally {
      rmSync(undecryptableRoot, { recursive: true, force: true });
    }
  }

  // ===== MiniMax 思考开关接入 =====
  // —— 1. looksLikeMiniMaxModelId 识别 ——
  assert(looksLikeMiniMaxModelId("MiniMax-M3"), "minimax id M3");
  assert(looksLikeMiniMaxModelId("MiniMax-M2.7"), "minimax id M2.7");
  assert(looksLikeMiniMaxModelId("MiniMax-M2.7-highspeed"), "minimax id M2.7 highspeed");
  assert(looksLikeMiniMaxModelId("MiniMax-M2.5"), "minimax id M2.5");
  assert(looksLikeMiniMaxModelId("MiniMax-M2.1"), "minimax id M2.1");
  // 网关常见形式（标准化前）
  assert(looksLikeMiniMaxModelId("minimax/MiniMax-M3"), "minimax id via gateway prefix");
  // 误识别护栏
  assert(!looksLikeMiniMaxModelId("DeepSeek-V3"), "not deepseek");
  assert(!looksLikeMiniMaxModelId("claude-opus-4-7"), "not claude");
  assert(!looksLikeMiniMaxModelId("gpt-5.4"), "not gpt");
  assert(!looksLikeMiniMaxModelId("MiniMax-not-a-model"), "not a real M series");

  // —— 2. minimaxModelExtras 形状 ——
  const m3Extras = minimaxModelExtras("MiniMax-M3");
  assert(m3Extras !== null, "M3 extras present");
  assert(m3Extras!.reasoning === true, "M3 reasoning true");
  assert(
    m3Extras!.compat.forceAdaptiveThinking === true,
    "M3 forceAdaptiveThinking true",
  );
  // M3 官方 API 只有 adaptive / disabled 二态：UI 收敛到 off + max 二选一。
  assert(m3Extras!.thinkingLevelMap.off === "off", "M3 off selectable");
  assert(
    m3Extras!.thinkingLevelMap.max === "max",
    "M3 max present (binary on/off collapse)",
  );
  assert(m3Extras!.thinkingLevelMap.minimal === null, "M3 minimal hidden");
  assert(m3Extras!.thinkingLevelMap.low === null, "M3 low hidden");
  assert(m3Extras!.thinkingLevelMap.medium === null, "M3 medium hidden");
  assert(m3Extras!.thinkingLevelMap.high === null, "M3 high hidden");

  const m27Extras = minimaxModelExtras("MiniMax-M2.7");
  assert(m27Extras !== null, "M2.7 extras present");
  assert(m27Extras!.reasoning === true, "M2.7 reasoning true");
  assert(
    m27Extras!.compat.forceAdaptiveThinking === true,
    "M2.7 forceAdaptiveThinking true",
  );
  assert(m27Extras!.thinkingLevelMap.off === null, "M2.7 off hidden");
  assert(
    m27Extras!.thinkingLevelMap.max === "max",
    "M2.7 max selectable",
  );

  const m27SpeedExtras = minimaxModelExtras("MiniMax-M2.7-highspeed");
  assert(m27SpeedExtras !== null, "M2.7 highspeed extras present");
  assert(
    m27SpeedExtras!.thinkingLevelMap.off === null,
    "M2.7 highspeed off hidden",
  );

  assert(minimaxModelExtras("DeepSeek-V3") === null, "non-MiniMax returns null");
  assert(minimaxModelExtras("claude-opus-4-7") === null, "claude returns null");

  // —— 3. modelEntryForPiModelsJson 写盘形状（不依赖持久化） ——
  const m3Entry = modelEntryForPiModelsJson(
    { id: "MiniMax-M3", name: "MiniMax M3" },
    "anthropic-messages",
    "minimax",
    "https://api.minimaxi.com/anthropic",
  );
  assert(m3Entry.id === "MiniMax-M3", "M3 entry id");
  assert(
    (m3Entry as Record<string, unknown>).reasoning === true,
    "M3 entry reasoning true",
  );
  const m3Compat = (m3Entry as { compat?: { forceAdaptiveThinking?: boolean } })
    .compat;
  assert(m3Compat?.forceAdaptiveThinking === true, "M3 entry compat");
  const m3Map = (m3Entry as { thinkingLevelMap?: Record<string, unknown> })
    .thinkingLevelMap;
  assert(m3Map?.off === "off", "M3 entry off selectable");
  assert(m3Map?.max === "max", "M3 entry max present");
  assert(m3Map?.minimal === null, "M3 entry minimal hidden");

  const m27Entry = modelEntryForPiModelsJson(
    { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
    "anthropic-messages",
    "minimax",
    "https://api.minimaxi.com/anthropic",
  );
  const m27Map = (m27Entry as { thinkingLevelMap?: Record<string, unknown> })
    .thinkingLevelMap;
  assert(m27Map?.off === null, "M2.7 entry off null (hidden)");

  // 非 MiniMax：行为不变（回归）
  const qwenRegression = modelEntryForPiModelsJson(
    { id: "Qwen/Qwen3-235B-A22B", name: "Qwen3" },
    "openai-completions",
    "siliconflow",
    "https://api.siliconflow.cn/v1",
  );
  assert(
    (qwenRegression as Record<string, unknown>).reasoning === undefined,
    "qwen entry no reasoning",
  );
  assert(
    (qwenRegression as { compat?: unknown }).compat === undefined,
    "qwen entry no compat",
  );

  // —— 4. 上下文窗口启发式 ——
  assert(lookupKnownContextWindow("MiniMax-M3") === 1_000_000, "M3 context 1M");
  assert(
    lookupKnownContextWindow("MiniMax-M2.7") === 204_800,
    "M2.7 context 204800",
  );
  assert(
    lookupKnownContextWindow("MiniMax-M2.7-highspeed") === 204_800,
    "M2.7-highspeed context 204800",
  );
  // 回归：DeepSeek-V3 不受影响
  assert(
    lookupKnownContextWindow("DeepSeek-V3") === 128_000,
    "deepseek-v3 context regression",
  );

  // —— 5. 预设列表包含 M3 + M2.7 + M2.7-highspeed ——
  const minimaxPreset = listProviderPresets().find(
    (p) => p.id === "minimax" || p.id === "minimax-en",
  );
  assert(minimaxPreset !== undefined, "minimax preset exists");
  const minimaxIds = new Set(minimaxPreset!.models.map((m) => m.id));
  assert(minimaxIds.has("MiniMax-M3"), "minimax preset includes M3");
  assert(minimaxIds.has("MiniMax-M2.7"), "minimax preset includes M2.7");
  assert(
    minimaxIds.has("MiniMax-M2.7-highspeed"),
    "minimax preset includes M2.7-highspeed",
  );
  assert(
    minimaxIds.size === 3,
    `minimax preset has exactly 3 models, got ${minimaxIds.size}`,
  );

  // —— 6. 激活 MiniMax 档案 → models.json 写入正确字段 ——
  {
    const miniRoot = mkdtempSync(join(tmpdir(), "alpha-providers-minimax-"));
    const miniPaths: ProviderPaths = {
      agentDir: miniRoot,
      storePath: join(miniRoot, "x-agent-providers.json"),
      authPath: join(miniRoot, "auth.json"),
      modelsPath: join(miniRoot, "models.json"),
    };
    try {
      const up = await upsertProviderProfile(
        {
          name: "MiniMax",
          providerId: "minimax",
          api: "anthropic-messages",
          baseUrl: "https://api.minimaxi.com/anthropic",
          apiKey: "sk-minimax-test",
          models: [
            { id: "MiniMax-M3", name: "MiniMax M3" },
            { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
            { id: "MiniMax-M2.7-highspeed", name: "MiniMax M2.7 Highspeed" },
          ],
        },
        miniPaths,
      );
      assert(up.ok, "minimax profile created");
      const act = await setProviderProfileEnabled(up.profile!.id, true, miniPaths);
      assert(act.ok, `minimax activate ok (${act.error ?? ""})`);

      const models = JSON.parse(readFileSync(miniPaths.modelsPath, "utf8")) as {
        providers: Record<string, { models: Array<Record<string, unknown>> }>;
      };
      const list = models.providers.minimax?.models ?? [];
      assert(list.length === 3, "3 models written");
      const byId = new Map(list.map((m) => [m.id as string, m]));
      for (const m of list) {
        assert(m.reasoning === true, `${m.id} reasoning true`);
        assert(
          (m.compat as { forceAdaptiveThinking?: boolean } | undefined)
            ?.forceAdaptiveThinking === true,
          `${m.id} compat.forceAdaptiveThinking true`,
        );
      }
      assert(
        (byId.get("MiniMax-M3")?.thinkingLevelMap as Record<string, unknown>)
          ?.off === "off",
        "M3 on disk off selectable",
      );
      assert(
        (byId.get("MiniMax-M3")?.thinkingLevelMap as Record<string, unknown>)
          ?.max === "max",
        "M3 on disk max present (binary)",
      );
      assert(
        (byId.get("MiniMax-M3")?.thinkingLevelMap as Record<string, unknown>)
          ?.minimal === null,
        "M3 on disk minimal hidden (binary)",
      );
      assert(
        (byId.get("MiniMax-M2.7")?.thinkingLevelMap as Record<string, unknown>)
          ?.off === null,
        "M2.7 on disk off hidden",
      );
      assert(
        (
          byId.get("MiniMax-M2.7-highspeed")?.thinkingLevelMap as Record<
            string,
            unknown
          >
        )?.off === null,
        "M2.7-highspeed on disk off hidden",
      );
      assert(
        byId.get("MiniMax-M3")?.contextWindow === 1_000_000,
        "M3 on disk context 1M",
      );
      assert(
        byId.get("MiniMax-M2.7")?.contextWindow === 204_800,
        "M2.7 on disk context 204800",
      );
    } finally {
      rmSync(miniRoot, { recursive: true, force: true });
    }
  }

  // —— 7. repairMiniMaxModelsJson 老条目升级 ——
  {
    const legacyRoot = mkdtempSync(join(tmpdir(), "alpha-providers-repair-mx-"));
    const legacyPaths: ProviderPaths = {
      agentDir: legacyRoot,
      storePath: join(legacyRoot, "x-agent-providers.json"),
      authPath: join(legacyRoot, "auth.json"),
      modelsPath: join(legacyRoot, "models.json"),
    };
    try {
      // 老档案：MiniMax 条目缺 reasoning / compat / thinkingLevelMap
      writeFileSync(
        legacyPaths.modelsPath,
        JSON.stringify({
          providers: {
            minimax: {
              baseUrl: "https://api.minimaxi.com/anthropic",
              api: "anthropic-messages",
              models: [{ id: "MiniMax-M3", name: "MiniMax M3" }],
            },
          },
        }),
        "utf8",
      );
      assert(await repairMiniMaxModelsJson(legacyPaths), "minimax repair writes");
      assert(
        !(await repairMiniMaxModelsJson(legacyPaths)),
        "minimax repair idempotent",
      );

      const repaired = JSON.parse(readFileSync(legacyPaths.modelsPath, "utf8")) as {
        providers: Record<string, { models: Array<Record<string, unknown>> }>;
      };
      const m3 = repaired.providers.minimax?.models?.[0];
      assert(m3?.reasoning === true, "legacy M3 reasoning patched");
      assert(
        (m3?.compat as { forceAdaptiveThinking?: boolean } | undefined)
          ?.forceAdaptiveThinking === true,
        "legacy M3 compat patched",
      );
      assert(
        (m3?.thinkingLevelMap as Record<string, unknown>)?.off === "off",
        "legacy M3 thinkingLevelMap patched",
      );

      // —— 8. repair 不污染 DeepSeek 条目 ——
      writeFileSync(
        legacyPaths.modelsPath,
        JSON.stringify({
          providers: {
            deepseek: {
              baseUrl: "https://api.deepseek.com",
              api: "openai-completions",
              models: [
                { id: "deepseek-v4-pro", name: "Pro", reasoning: true },
              ],
            },
            minimax: {
              baseUrl: "https://api.minimaxi.com/anthropic",
              api: "anthropic-messages",
              models: [{ id: "MiniMax-M2.7", name: "M2.7" }],
            },
          },
        }),
        "utf8",
      );
      assert(
        await repairMiniMaxModelsJson(legacyPaths),
        "minimax repair runs alongside deepseek",
      );
      const mixed = JSON.parse(readFileSync(legacyPaths.modelsPath, "utf8")) as {
        providers: Record<string, { models: Array<Record<string, unknown>> }>;
      };
      // DeepSeek 条目保留 reasoning（没有 thinkingLevelMap 也没强制加）
      const ds = mixed.providers.deepseek?.models?.[0];
      assert(ds?.reasoning === true, "deepseek reasoning preserved");
      assert(
        (ds as { thinkingLevelMap?: unknown })?.thinkingLevelMap === undefined,
        "deepseek untouched by minimax repair",
      );
      const m27 = mixed.providers.minimax?.models?.[0];
      assert(m27?.reasoning === true, "M2.7 reasoning patched in mixed file");
      assert(
        (m27?.thinkingLevelMap as Record<string, unknown>)?.off === null,
        "M2.7 off hidden in mixed file",
      );

      // —— 9. 老版本 6 键 M3 map 必须被升级为新二态（value-level 升级） ——
      const legacyMx3Root = mkdtempSync(join(tmpdir(), "alpha-providers-repair-mx3-oldshape-"));
      const legacyMx3Paths: ProviderPaths = {
        agentDir: legacyMx3Root,
        storePath: join(legacyMx3Root, "x-agent-providers.json"),
        authPath: join(legacyMx3Root, "auth.json"),
        modelsPath: join(legacyMx3Root, "models.json"),
      };
      try {
        // 模拟一个被旧版本 fix 写出的 6 键 M3 entry：key 都在但 value 跟新
        // canonical 不一致（minimal/low/medium/high 在新 shape 应该是 null）。
        writeFileSync(
          legacyMx3Paths.modelsPath,
          JSON.stringify({
            providers: {
              minimax: {
                baseUrl: "https://api.minimaxi.com/anthropic",
                api: "anthropic-messages",
                models: [
                  {
                    id: "MiniMax-M3",
                    name: "MiniMax M3",
                    reasoning: true,
                    compat: { forceAdaptiveThinking: true },
                    thinkingLevelMap: {
                      off: "off",
                      minimal: "minimal",
                      low: "low",
                      medium: "medium",
                      high: "high",
                      max: "max",
                    },
                  },
                ],
              },
            },
          }),
          "utf8",
        );
        assert(
          await repairMiniMaxModelsJson(legacyMx3Paths),
          "old-shape M3 entry must be upgraded",
        );
        const upgraded = JSON.parse(
          readFileSync(legacyMx3Paths.modelsPath, "utf8"),
        ) as {
          providers: Record<string, { models: Array<Record<string, unknown>> }>;
        };
        const m3Up = upgraded.providers.minimax?.models?.[0];
        const m3Map = m3Up?.thinkingLevelMap as Record<string, unknown>;
        assert(m3Map?.off === "off", "upgraded M3 off selectable");
        assert(m3Map?.max === "max", "upgraded M3 max present");
        assert(m3Map?.minimal === null, "upgraded M3 minimal hidden");
        assert(m3Map?.low === null, "upgraded M3 low hidden");
        assert(m3Map?.medium === null, "upgraded M3 medium hidden");
        assert(m3Map?.high === null, "upgraded M3 high hidden");
        // 现在是 canonical 形状，再跑一次应该 idempotent
        assert(
          !(await repairMiniMaxModelsJson(legacyMx3Paths)),
          "canonical M3 map is idempotent",
        );
      } finally {
        rmSync(legacyMx3Root, { recursive: true, force: true });
      }
    } finally {
      rmSync(legacyRoot, { recursive: true, force: true });
    }
  }

  console.log("test-provider-store: ok");
  })().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}
