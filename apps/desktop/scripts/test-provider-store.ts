import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  activateProviderProfile,
  deleteProviderProfile,
  listProviderPresets,
  listProviderProfiles,
  type ProviderPaths,
  upsertProviderProfile,
} from "../electron/agent/provider-store";

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

  console.log("test-provider-store: ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}
