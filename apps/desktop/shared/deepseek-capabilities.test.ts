/** Verify provider identity alone never activates DeepSeek-only request extensions. */
import { describe, expect, it } from "vitest";
import { supportsDeepSeekChatbot } from "./deepseek-capabilities";

const target = { id: "deepseek-flash", api: "openai-completions", baseUrl: "https://api.deepseek.com" };

describe("DeepSeek application capabilities", () => {
  it.each(["https://api.deepseek.com", "https://api.deepseek.com/v1/"])("accepts official completions endpoint %s", (baseUrl) => {
    expect(supportsDeepSeekChatbot({ ...target, baseUrl })).toBe(true);
  });

  it.each(["https://api.deepseek.com/anthropic", "https://api.deepseek.com/anthropic/v1/"])("accepts official Messages endpoint %s", (baseUrl) => {
    expect(supportsDeepSeekChatbot({ ...target, api: "anthropic-messages", baseUrl })).toBe(true);
  });

  it.each([
    { id: "deepseek-v4-flash" }, { id: "deepseek-chat" }, { id: "deepseek-ai/deepseek-flash" },
    { id: "gpt-5" }, { api: "openai-responses" }, { api: "anthropic-messages" },
    { baseUrl: "https://api.deepseek.com.evil.example" }, { baseUrl: "https://proxy.example/v1" },
    { baseUrl: "http://api.deepseek.com" }, { baseUrl: "https://api.deepseek.com:444" },
    { baseUrl: "https://user:secret@api.deepseek.com" }, { baseUrl: "https://api.deepseek.com/?key=x" },
    { baseUrl: "https://api.deepseek.com/#x" }, { baseUrl: "https://api.deepseek.com/proxy" },
    { baseUrl: "invalid" },
  ])("rejects an unsupported target %j", (patch) => {
    expect(supportsDeepSeekChatbot({ ...target, ...patch })).toBe(false);
  });

  it("rejects missing targets", () => {
    expect(supportsDeepSeekChatbot()).toBe(false);
    expect(supportsDeepSeekChatbot(null)).toBe(false);
  });
});
