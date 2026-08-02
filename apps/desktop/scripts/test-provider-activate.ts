/**
 * Provider activate transaction: disk write + runtime apply + prefs rollback.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateProviderAndApply } from "../electron/agent/provider-activate";
import {
  upsertProviderProfile,
  type ProviderPaths,
} from "../electron/agent/provider-store";
import { patchPrefs, loadPrefs, setAgentDirOverrideForTests } from "../electron/agent/prefs";

const root = mkdtempSync(join(tmpdir(), "x-agent-provider-activate-"));
const paths: ProviderPaths = {
  storePath: join(root, "providers.json"),
  authPath: join(root, "auth.json"),
  modelsPath: join(root, "models.json"),
};

mkdirSync(root, { recursive: true });
writeFileSync(paths.authPath, "{}", "utf8");
writeFileSync(paths.modelsPath, JSON.stringify({ providers: {} }), "utf8");
writeFileSync(
  paths.storePath,
  JSON.stringify({ version: 1, activeId: null, profiles: [] }),
  "utf8",
);

// Isolate prefs patch target via env if the store uses default agent dir —
// provider-activate uses loadPrefs/patchPrefs from real prefs path.
// We only assert rollback contract with a fake applyRuntime.

void (async () => {
setAgentDirOverrideForTests(root);

// Load once under the override so any subsequent patchPrefs writes to root.
loadPrefs();

const created = await upsertProviderProfile(
  {
    name: "test",
    providerId: "test-prov",
    api: "openai-completions",
    baseUrl: "https://example.com/v1",
    apiKey: "sk-test",
    models: [{ id: "m1", name: "M1" }],
  },
  paths,
);
assert.ok(created.ok && created.profile, "upsert");
const id = created.profile!.id;

const before = loadPrefs();
await patchPrefs({ provider: "old-prov", model: "old-model" });

{
  const ok = await activateProviderAndApply(
    id,
    async () => ({ ok: true }),
    paths,
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.provider, "test-prov");
  assert.equal(ok.model, "m1");
}

patchPrefs({ provider: "old-prov", model: "old-model" });
{
  const fail = await activateProviderAndApply(
    id,
    async () => ({ ok: false, error: "boom" }),
    paths,
  );
  assert.equal(fail.ok, false);
  assert.ok(fail.error?.includes("boom") || fail.error?.includes("运行时"));
  const prefs = loadPrefs();
  assert.equal(prefs.provider, "old-prov");
  assert.equal(prefs.model, "old-model");
}

await patchPrefs({ provider: before.provider, model: before.model });
setAgentDirOverrideForTests(null);
rmSync(root, { recursive: true, force: true });
console.log("test-provider-activate: ok");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
