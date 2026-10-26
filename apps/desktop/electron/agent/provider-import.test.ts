/** Verify Pi provider imports preserve explicit protocols while following current built-in defaults. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importExistingProviderProfiles } from "./provider-import";
import { loadStore, type ProviderPaths } from "./provider-persist";

describe("Kimi Coding imports with Pi 1.4", () => {
  let directory: string;
  let paths: ProviderPaths;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "x-agent-kimi-import-"));
    paths = {
      agentDir: directory,
      storePath: join(directory, "providers.json"),
      authPath: join(directory, "auth.json"),
      modelsPath: join(directory, "models.json"),
    };
    writeFileSync(paths.authPath, JSON.stringify({
      "kimi-coding": { type: "api_key", key: "fixture-kimi-key" },
    }));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  /** Import isolated Pi files without reading the user's cc-switch database. */
  async function importPi(config: Record<string, unknown>): Promise<void> {
    writeFileSync(paths.modelsPath, JSON.stringify({ providers: { "kimi-coding": config } }));
    const result = await importExistingProviderProfiles(paths, {
      ccSwitchDbPath: join(directory, "missing-cc-switch.db"),
    });
    expect(result.ok).toBe(true);
  }

  it("uses Chat Completions for a native provider override that omits api", async () => {
    await importPi({
      baseUrl: "https://api.kimi.com/coding/v1",
      models: [{ id: "k3" }],
    });

    const { profiles } = await loadStore(paths);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      providerId: "kimi-coding",
      api: "openai-completions",
      baseUrl: "https://api.kimi.com/coding/v1",
      models: [{ id: "k3" }],
    });
    expect(JSON.parse(readFileSync(paths.modelsPath, "utf8")).providers["kimi-coding"].api).toBeUndefined();
  });

  it("preserves an explicitly configured legacy Anthropic endpoint", async () => {
    await importPi({
      api: "anthropic-messages",
      baseUrl: "https://api.kimi.com/coding/",
      models: [{ id: "kimi-for-coding" }],
    });

    const { profiles } = await loadStore(paths);
    expect(profiles[0]).toMatchObject({
      api: "anthropic-messages",
      baseUrl: "https://api.kimi.com/coding",
      models: [{ id: "kimi-for-coding" }],
    });
  });

  it("keeps an existing legacy profile intact when importing the new protocol", async () => {
    await importPi({
      api: "anthropic-messages",
      baseUrl: "https://api.kimi.com/coding/",
      models: [{ id: "kimi-for-coding" }],
    });
    const original = (await loadStore(paths)).profiles[0];

    await importPi({
      baseUrl: "https://api.kimi.com/coding/v1",
      models: [{ id: "k3" }],
    });

    const { profiles } = await loadStore(paths);
    expect(profiles).toHaveLength(2);
    expect(profiles.find((profile) => profile.id === original.id)).toEqual(original);
    expect(profiles.find((profile) => profile.id !== original.id)).toMatchObject({
      providerId: "kimi-coding-2",
      api: "openai-completions",
    });
  });
});
