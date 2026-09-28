/**
 * Vitest 套件 —— provider-pi-models / model-repair 启动期修复。
 *
 * 锁住以下不变量:
 * 1. reasoning 缺失 -> 补 true
 * 2. thinkingLevelMap value-level 比对: 老 high/max map 会被刷成 canonical off-only
 * 3. compat 缺失 + 非官方 deepseek.com 端点 -> 补 deepseek compat
 * 4. canonical 已正确时返回 false (不写盘)
 *
 * 直接操作 tmp 文件,避免污染 ~/.pi/agent/models.json。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repairDeepSeekModelsJson } from "./model-repair";
import type { ProviderPaths } from "../provider-persist";

let tmpDir: string;
let modelsPath: string;
let paths: ProviderPaths;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "model-repair-test-"));
  modelsPath = join(tmpDir, "models.json");
  paths = {
    authPath: join(tmpDir, "auth.json"),
    modelsPath,
  };
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeModels(content: unknown): void {
  writeFileSync(modelsPath, JSON.stringify(content, null, 2), "utf-8");
}

describe("repairDeepSeekModelsJson", () => {
  it("canonical 已正确 -> 不写盘", async () => {
    writeModels({
      providers: {
        deepseek: {
          baseUrl: "https://api.deepseek.com",
          api: "openai-completions",
          models: [
            {
              id: "deepseek-flash",
              contextWindow: 1000000,
              input: ["text", "image"],
              reasoning: true,
              thinkingLevelMap: {
                off: "off",
                minimal: "high",
                low: "high",
                medium: "high",
                high: "high",
                max: "high",
              },
            },
          ],
        },
      },
    });
    const changed = await repairDeepSeekModelsJson(paths);
    expect(changed).toBe(false);
  });

  it("老 high/max map 会被刷成 off-only 形态", async () => {
    writeModels({
      providers: {
        deepseek: {
          baseUrl: "https://api.deepseek.com",
          api: "openai-completions",
          models: [
            {
              id: "deepseek-v4-pro",
              contextWindow: 1000000,
              reasoning: true,
              thinkingLevelMap: {
                minimal: null,
                low: null,
                medium: null,
                high: "high",
                max: "max",
              },
            },
          ],
        },
      },
    });
    const changed = await repairDeepSeekModelsJson(paths);
    expect(changed).toBe(true);
    const after = JSON.parse(
      require("node:fs").readFileSync(modelsPath, "utf-8"),
    );
    expect(after.providers.deepseek.models[0].thinkingLevelMap).toEqual({
      off: "off",
      minimal: "high",
      low: "high",
      medium: "high",
      high: "high",
      max: "high",
    });
  });

  it("reasoning + contextWindow 缺失 -> 同时补齐", async () => {
    writeModels({
      providers: {
        deepseek: {
          baseUrl: "https://api.deepseek.com",
          api: "openai-completions",
          models: [
            {
              id: "deepseek-flash",
            },
          ],
        },
      },
    });
    const changed = await repairDeepSeekModelsJson(paths);
    expect(changed).toBe(true);
    const after = JSON.parse(
      require("node:fs").readFileSync(modelsPath, "utf-8"),
    );
    expect(after.providers.deepseek.models[0].reasoning).toBe(true);
    expect(after.providers.deepseek.models[0].contextWindow).toBe(1_000_000);
    expect(after.providers.deepseek.models[0].thinkingLevelMap).toEqual({
      off: "off",
      minimal: "high",
      low: "high",
      medium: "high",
      high: "high",
      max: "high",
    });
  });

  it("contextWindow 显式值优先于 lookup", async () => {
    writeModels({
      providers: {
        deepseek: {
          baseUrl: "https://api.deepseek.com",
          api: "openai-completions",
          models: [
            {
              id: "deepseek-flash",
              contextWindow: 42_000,
              reasoning: true,
              thinkingLevelMap: {
                off: "off",
                minimal: "high",
                low: "high",
                medium: "high",
                high: "high",
                max: "high",
              },
            },
          ],
        },
      },
    });
    const changed = await repairDeepSeekModelsJson(paths);
    expect(changed).toBe(false);
    const after = JSON.parse(
      require("node:fs").readFileSync(modelsPath, "utf-8"),
    );
    expect(after.providers.deepseek.models[0].contextWindow).toBe(42_000);
  });

  it("硅基流动等代理 (非 deepseek.com) -> 补 compat", async () => {
    writeModels({
      providers: {
        siliconflow: {
          baseUrl: "https://api.siliconflow.cn/v1",
          api: "openai-completions",
          models: [
            {
              id: "deepseek-ai/DeepSeek-Flash",
              reasoning: true,
            },
          ],
        },
      },
    });
    const changed = await repairDeepSeekModelsJson(paths);
    expect(changed).toBe(true);
    const after = JSON.parse(
      require("node:fs").readFileSync(modelsPath, "utf-8"),
    );
    expect(after.providers.siliconflow.models[0].compat).toEqual({
      thinkingFormat: "deepseek",
      requiresReasoningContentOnAssistantMessages: true,
    });
  });

  it("非 DeepSeek id -> 不动", async () => {
    writeModels({
      providers: {
        openai: {
          baseUrl: "https://api.openai.com/v1",
          api: "openai-completions",
          models: [{ id: "gpt-4o", input: ["text", "image"] }],
        },
      },
    });
    const changed = await repairDeepSeekModelsJson(paths);
    expect(changed).toBe(false);
  });
});