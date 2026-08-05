import { reloadAuthStorageCache } from "../electron/agent/model-runtime-auth";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
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
  const before = await runtime.getAvailable();
  assert(
    !before.some((m) => m.provider === "test-relay" && m.id === "model-a"),
    "start without test-relay model",
  );

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

  await runtime.refresh();
  const afterConfigOnly = await runtime.getAvailable();
  assert(
    !afterConfigOnly.some(
      (m) => m.provider === "test-relay" && m.id === "model-a",
    ),
    "refresh alone must not expose test-relay (auth cache stale)",
  );

  reloadAuthStorageCache(runtime);
  await runtime.refresh();
  const available = await runtime.getAvailable();
  assert(
    available.some((m) => m.provider === "test-relay" && m.id === "model-a"),
    "auth.reload + refresh should expose models",
  );

  console.log("test-model-runtime-reload: ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}
