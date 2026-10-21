/** Verify web request contracts, credential isolation and live permission checks without network access. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderProfile } from "../../shared/ipc";
import { createDeepSeekWebTools } from "./deepseek-web-tools";

const state = vi.hoisted(() => ({
  prefs: { tools: ["web_search", "web_fetch"], deepseekWebProviderId: "official" as string | null },
  getProfile: vi.fn(), post: vi.fn(), validateTarget: vi.fn(),
}));
vi.mock("./prefs", () => ({ getCachedPrefs: () => state.prefs }));
vi.mock("./provider-store", () => ({ getProviderProfile: state.getProfile }));
vi.mock("./public-http", () => ({ publicHttpPost: state.post }));
vi.mock("./external-url", async (original) => ({
  ...await original<typeof import("./external-url")>(), validateOutboundHttpUrl: state.validateTarget,
}));

const profile: ProviderProfile = {
  id: "official", name: "DeepSeek", providerId: "deepseek", api: "openai-completions",
  baseUrl: "https://api.deepseek.com", apiKey: "sk-fixture-secret", models: [], enabled: true, updatedAt: "",
};
const row = { title: "Godot docs", url: "https://docs.godotengine.org/en/stable/", summary: "Official documentation",
  snippet: "Godot", content: "# Docs", date: null, site_name: "Godot", rerank_score: 2.8, authority: 4 };

/** Invoke the registered definition just as Pi does; no context is needed by these standalone tools. */
function execute(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
  return createDeepSeekWebTools().find((tool) => tool.name === name)!.execute("call", args, signal, undefined, {} as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  state.prefs = { tools: ["web_search", "web_fetch"], deepseekWebProviderId: "official" };
  state.getProfile.mockResolvedValue({ ...profile });
  state.validateTarget.mockImplementation(async (url: string) => ({ ok: true, href: url }));
  state.post.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify({ results: [row] }) });
});

describe("DeepSeek web tools", () => {
  it("passes all documented search fields, preserves sources and hides secrets", async () => {
    const args = { query: 'Godot site:docs.godotengine.org after:2026 lang:en', count: 5,
      ori_question: "Godot updates", need_content: true, localization: "8.8.8.8" };
    const result = await execute("web_search", args);
    expect(state.post).toHaveBeenCalledWith("https://api.deepseek.com/v1/tools/search",
      { Authorization: "Bearer sk-fixture-secret" }, args, 30_000, undefined);
    expect(JSON.stringify(result)).toContain(row.url);
    expect(JSON.stringify(result)).toContain(row.content);
    expect(JSON.stringify(result)).not.toContain(profile.apiKey);
    expect(result.details).toMatchObject({ count: 1, truncated: false });
  });

  it("accepts Unicode code points at the 128-character boundary and omits unsolicited bodies", async () => {
    const result = await execute("web_search", { query: "𠀀".repeat(128), ori_question: null });
    expect(JSON.stringify(result)).not.toContain(row.content);
    expect(state.post).toHaveBeenCalledOnce();
  });

  it.each([
    { query: " " }, { query: "x".repeat(129) }, { query: "ok", ori_question: " " },
    { query: "ok", count: 0 }, { query: "ok", count: 51 }, { query: "ok", count: 1.5 },
    { query: "ok", localization: "not-an-ip" },
  ])("rejects invalid search input before looking up credentials: %j", async (args) => {
    await expect(execute("web_search", args)).rejects.toThrow();
    expect(state.getProfile).not.toHaveBeenCalled();
    expect(state.post).not.toHaveBeenCalled();
  });

  it("accepts an empty successful search and bounds oversized output without retaining raw details", async () => {
    state.post.mockResolvedValueOnce({ ok: true, status: 200, body: '{"results":[]}' });
    expect((await execute("web_search", { query: "no results" })).details).toMatchObject({ count: 0 });
    state.post.mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify({ results: [{ ...row, content: "x".repeat(80_000) }] }) });
    const result = await execute("web_search", { query: "large", need_content: true });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("已截断") });
    expect(JSON.stringify(result).length).toBeLessThan(62_000);
    expect(result.details).toMatchObject({ truncated: true });
  });

  it.each(["web_search", "web_fetch"])("blocks disabled tools before credential/DNS/network access: %s", async (name) => {
    state.prefs.tools = [];
    await expect(execute(name, name === "web_search" ? { query: "Godot" } : { url: "https://example.com" })).rejects.toThrow("未启用");
    expect(state.getProfile).not.toHaveBeenCalled();
    expect(state.validateTarget).not.toHaveBeenCalled();
    expect(state.post).not.toHaveBeenCalled();
  });

  it("does not silently choose credentials when no profile was selected", async () => {
    state.prefs.deepseekWebProviderId = null;
    await expect(execute("web_search", { query: "Godot" })).rejects.toThrow("选择供应商");
    expect(state.getProfile).not.toHaveBeenCalled();
  });

  it.each([null, { ...profile, enabled: false }, { ...profile, apiKey: "" },
    { ...profile, baseUrl: "https://proxy.example/v1" }])("rejects missing, disabled, locked or third-party profiles", async (value) => {
    state.getProfile.mockResolvedValue(value);
    await expect(execute("web_search", { query: "Godot" })).rejects.toThrow();
    expect(state.post).not.toHaveBeenCalled();
  });

  it("uses a selected official Anthropic profile with the fixed search URL", async () => {
    state.getProfile.mockResolvedValue({ ...profile, baseUrl: "https://api.deepseek.com/anthropic", api: "anthropic-messages" });
    await execute("web_search", { query: "Godot" });
    expect(state.post.mock.calls[0][0]).toBe("https://api.deepseek.com/v1/tools/search");
  });

  it("rereads credentials and rejects settings changes during async resolution", async () => {
    state.getProfile.mockImplementationOnce(async () => { state.prefs.tools = []; return profile; });
    await expect(execute("web_search", { query: "Godot" })).rejects.toThrow("配置已变更");
    expect(state.post).not.toHaveBeenCalled();
    state.prefs.tools = ["web_search"];
    state.getProfile.mockResolvedValueOnce({ ...profile, apiKey: "rotated-secret" });
    await execute("web_search", { query: "Godot" });
    expect(state.post.mock.calls[0][1]).toEqual({ Authorization: "Bearer rotated-secret" });
  });

  it("fetches Markdown through DeepSeek, after public-target validation", async () => {
    state.post.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify({ title: "Godot", content: "# Godot\nMarkdown body" }) });
    const result = await execute("web_fetch", { url: "https://example.com/article" });
    expect(state.validateTarget).toHaveBeenCalledWith("https://example.com/article");
    expect(state.post).toHaveBeenCalledWith("https://api.deepseek.com/v1/tools/fetch", expect.any(Object),
      { url: "https://example.com/article" }, 30_000, undefined);
    expect(JSON.stringify(result)).toContain("Markdown body");
    expect(result.details).toMatchObject({ url: "https://example.com/article", truncated: false });
  });

  it.each(["file:///C:/secret.txt", "http://localhost/", "http://127.0.0.1/", "http://10.0.0.1/",
    "https://127.0.0.1.nip.io/", "https://user:password@example.com/", `https://example.com/${"x".repeat(8192)}`])("blocks invalid fetch targets: %s", async (url) => {
    await expect(execute("web_fetch", { url })).rejects.toThrow();
    expect(state.post).not.toHaveBeenCalled();
  });

  it("rejects private DNS answers and settings changes during fetch validation", async () => {
    state.validateTarget.mockResolvedValueOnce({ ok: false, error: "域名解析到私有网络" });
    await expect(execute("web_fetch", { url: "https://example.com" })).rejects.toThrow("私有网络");
    state.validateTarget.mockImplementationOnce(async () => {
      state.prefs.deepseekWebProviderId = "changed";
      return { ok: true, href: "https://example.com" };
    });
    await expect(execute("web_fetch", { url: "https://example.com" })).rejects.toThrow("配置已变更");
    expect(state.post).not.toHaveBeenCalled();
  });

  it.each([[401, "API Key"], [402, "余额不足"], [403, "安全策略"], [404, "不可用"],
    [429, "频率超限"], [500, "暂不可用"], [504, "暂不可用"]])("explains HTTP %s without echoing error bodies or retrying", async (status, message) => {
    state.post.mockResolvedValue({ ok: false, status, body: JSON.stringify({ error: { message: profile.apiKey } }) });
    await expect(execute("web_search", { query: "Godot" })).rejects.toThrow(String(message));
    expect(state.post).toHaveBeenCalledOnce();
  });

  it.each(["not json", "null", "[]", '{"results":null}', '{"results":[{}]}'])("rejects malformed search responses: %s", async (body) => {
    state.post.mockResolvedValue({ ok: true, status: 200, body });
    await expect(execute("web_search", { query: "Godot" })).rejects.toThrow();
  });

  it("rejects malformed fetch data and bounds large Markdown content", async () => {
    state.post.mockResolvedValueOnce({ ok: true, status: 200, body: '{"title":"missing body"}' });
    await expect(execute("web_fetch", { url: "https://example.com" })).rejects.toThrow("格式不正确");
    state.post.mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify({ title: "", content: "x".repeat(70_000) }) });
    expect((await execute("web_fetch", { url: "https://example.com" })).details).toMatchObject({ truncated: true });
  });

  it("handles cancellation before and during transport without exposing transport errors", async () => {
    const cancelled = AbortSignal.abort();
    await expect(execute("web_search", { query: "Godot" }, cancelled)).rejects.toThrow();
    expect(state.post).not.toHaveBeenCalled();
    const controller = new AbortController();
    state.post.mockImplementationOnce(async () => { controller.abort(); throw new Error(profile.apiKey); });
    await expect(execute("web_search", { query: "Godot" }, controller.signal)).rejects.toThrow("已取消");
    state.post.mockRejectedValueOnce(new Error(profile.apiKey));
    await expect(execute("web_search", { query: "Godot" })).rejects.toThrow("请求失败或超时");
  });
});
