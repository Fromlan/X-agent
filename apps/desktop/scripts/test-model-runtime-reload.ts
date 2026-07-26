/**
 * Repro: external auth.json write + reloadConfig alone leaves getAvailable empty;
 * AuthStorage.reload() before reloadConfig fixes it.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function reloadAuthStorageCache(runtime: ModelRuntime): void {
  const store = (
    runtime as unknown as {
      credentials?: { store?: { reload?: () => void } };
    }
  ).credentials?.store;
  store?.reload?.();
}

const root = mkdtempSync(join(tmpdir(), "x-agent-runtime-reload-"));
const authPath = join(root, "auth.json");
const modelsPath = join(root, "models.json");

try {
  writeFileSync(authPath, "{}", "utf8");
  writeFileSync(modelsPath, JSON.stringify({ providers: {} }), "utf8");

  const runtime = await ModelRuntime.create({
    authPath,
    modelsPath,
    allowModelNetwork: false,
  });
  assert((await runtime.getAvailable()).length === 0, "start empty");

  // Simulate provider activate writing files while runtime stays alive.
  writeFileSync(
    authPath,
    JSON.stringify(
      {
        "test-relay": { type: "api_key", key: "sk-test-key-for-reload" },
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    modelsPath,
    JSON.stringify(
      {
        providers: {
          "test-relay": {
            baseUrl: "https://example.com/v1",
            api: "openai-completions",
            models: [{ id: "model-a", name: "Model A" }],
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await runtime.reloadConfig();
  assert(
    (await runtime.getAvailable()).length === 0,
    "reloadConfig alone must stay empty (auth cache stale)",
  );

  reloadAuthStorageCache(runtime);
  await runtime.reloadConfig();
  const available = await runtime.getAvailable();
  assert(
    available.some((m) => m.provider === "test-relay" && m.id === "model-a"),
    "auth.reload + reloadConfig should expose models",
  );

  console.log("test-model-runtime-reload: ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}
