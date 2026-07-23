import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  activateProviderProfile,
  deleteProviderProfile,
  importExistingProviderProfiles,
  listProviderPresets,
  listProviderProfiles,
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
  assert(listProviderPresets().length >= 4, "presets");

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

  rmSync(importRoot, { recursive: true, force: true });

  console.log("test-provider-store: ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}
