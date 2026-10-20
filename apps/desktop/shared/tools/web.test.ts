/** Protect web-tool opt-in, credential origin checks and read-only mode integration. */
import { expect, it } from "vitest";
import { Value } from "typebox/value";
import { ClientPrefsPatchSchema, DEFAULT_PREFS } from "../ipc";
import { isDeepSeekWebProvider, WEB_TOOLS } from "./web";
import { computeAskModeTools, computePlanModeTools } from "../../electron/agent/session-mode/plan-tools";
import { computeDesignSessionTypeTools } from "../session-type-tools";
import { shouldBlockDesignSessionWrite } from "../../electron/agent/session-mode/design-write-guard";
import { shouldBlockReadonlyModeToolCall } from "../../electron/agent/session-mode/plan-mode-guard";

it.each(["https://api.deepseek.com", "https://api.deepseek.com/v1/", "https://api.deepseek.com/anthropic", "https://api.deepseek.com/anthropic/v1"])("accepts an official DeepSeek credential endpoint: %s", (baseUrl) => {
  expect(isDeepSeekWebProvider({ baseUrl })).toBe(true);
});

it.each(["garbage", "http://api.deepseek.com", "https://api.deepseek.com.evil.example", "https://api.deepseek.com@evil.example",
  "https://user:pass@api.deepseek.com", "https://api.deepseek.com:444", "https://api.deepseek.com/proxy", "https://api.deepseek.com/?key=x"])("rejects third-party or credential-bearing endpoints: %s", (baseUrl) => {
  expect(isDeepSeekWebProvider({ baseUrl })).toBe(false);
});

it("keeps tools and credentials opt-in and validates the existing prefs IPC contract", () => {
  expect(DEFAULT_PREFS.deepseekWebProviderId).toBeNull();
  expect(DEFAULT_PREFS.tools).not.toEqual(expect.arrayContaining(WEB_TOOLS));
  expect(Value.Check(ClientPrefsPatchSchema, { deepseekWebProviderId: "official" })).toBe(true);
  expect(Value.Check(ClientPrefsPatchSchema, { deepseekWebProviderId: null })).toBe(true);
  expect(Value.Check(ClientPrefsPatchSchema, { deepseekWebProviderId: 1 })).toBe(false);
  expect(Value.Check(ClientPrefsPatchSchema, { deepseekWebApiKey: "secret" })).toBe(false);
});

it("includes only enabled web tools in Ask, Plan and Design, while write restrictions remain enforced", () => {
  for (const compute of [computeAskModeTools, computePlanModeTools, computeDesignSessionTypeTools]) {
    expect(compute(["web_search"])).toContain("web_search");
    expect(compute(["web_search"])).not.toContain("web_fetch");
    expect(compute([])).not.toEqual(expect.arrayContaining(WEB_TOOLS));
  }
  for (const tool of WEB_TOOLS) {
    expect(shouldBlockDesignSessionWrite("design", tool, {}, "C:/project")).toEqual({ block: false });
    for (const mode of ["ask", "plan"] as const) {
      expect(shouldBlockReadonlyModeToolCall(mode, tool, [tool], {}, "C:/project")).toEqual({ block: false });
      expect(shouldBlockReadonlyModeToolCall(mode, tool, [], {}, "C:/project").block).toBe(true);
      expect(shouldBlockReadonlyModeToolCall(mode, "write", [tool], { path: "main.gd" }, "C:/project").block).toBe(true);
    }
  }
});
