/** Exercise DeepSeek extensions through the real Pi protocol adapters with offline SSE responses. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Type } from "typebox";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions, TranscriptContext } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { streamSimple as openaiStream } from "@earendil-works/pi-ai/api/openai-completions";
import { streamSimple as anthropicStream } from "@earendil-works/pi-ai/api/anthropic-messages";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { encodeDeepSeekDocument } from "../../shared/deepseek-documents";
import type { ClientPrefs } from "../../shared/ipc";
import { getDeepSeekResponseTitle, sanitizeDeepSeekFilePayload, wrapDeepSeekChatbotStream } from "./deepseek-chatbot";

const baseModel: Model<Api> = { id: "deepseek-flash", name: "DeepSeek Flash", provider: "deepseek", api: "openai-completions", baseUrl: "https://api.deepseek.com", reasoning: true,
  contextWindow: 1_000_000, maxTokens: 8192, input: ["text", "image"], cost: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 0 } };
const timestamp = new Date(2026, 10, 16, 12).getTime();
const authScope = createHash("sha256").update("x-agent-deepseek-files\0fixture-key").digest("hex");
const tool = (name: string) => ({ name, description: name, parameters: Type.Object({}) });
const user = (content = "问题") => ({ role: "user" as const, content, timestamp });
type ChatbotPrefs = Pick<ClientPrefs, "deepseekLatestReminder" | "deepseekSafetyCheck">;
const reminderPrefs = (): ChatbotPrefs => ({ deepseekLatestReminder: true, deepseekSafetyCheck: false });
const allChatbotPrefs = (): ChatbotPrefs => ({ deepseekLatestReminder: true, deepseekSafetyCheck: true });

/** Serialize protocol events without ever reaching an external endpoint. */
function sse(events: unknown[], messages = false): Response {
  return new Response(events.map((event) => `${messages ? `event: ${(event as { type: string }).type}\n` : ""}data: ${JSON.stringify(event)}\n\n`).join("") + (messages ? "" : "data: [DONE]\n\n"),
    { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** Build a native OpenAI chunk with the same extension placement documented by DeepSeek. */
function chunk(delta: unknown, finish: string | null = null, usage?: unknown): unknown {
  return { id: "completion-fixture", object: "chat.completion.chunk", model: "deepseek-flash", choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) };
}

/** Preserve Pi's real serialization and usage behavior while substituting only HTTP transport. */
function harness(events: unknown[], model = baseModel, apiKey = "fixture-key", getPrefs?: () => ChatbotPrefs) {
  const requests: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
  const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
    requests.push({ url: _input instanceof Request ? _input.url : String(_input), body: JSON.parse(String(init?.body)) as Record<string, unknown>, headers: new Headers(init?.headers) });
    return sse(events, model.api === "anthropic-messages");
  });
  const original: StreamFn = (target, context, options) => target.api === "anthropic-messages"
    ? anthropicStream(target as Model<"anthropic-messages">, context, { ...options, apiKey })
    : openaiStream(target as Model<"openai-completions">, context, { ...options, apiKey });
  const wrapped = wrapDeepSeekChatbotStream(original, undefined, getPrefs);
  return {
    requests, original,
    async run(context: Context | TranscriptContext = { messages: [user()], tools: [tool("web_search"), tool("web_fetch")] }, options?: SimpleStreamOptions) {
      const stream = await wrapped(model, normalizeContext(context), { fetch, ...options });
      const updates = [];
      for await (const event of stream) updates.push(event);
      return { message: await stream.result(), updates };
    },
  };
}

describe("DeepSeek Chatbot stream integration", () => {
  it("defaults reminder and safety checking to off and removes stale injected optional fields", async () => {
    const fixture = harness([chunk({ content: "回答" }, "stop")]);
    await fixture.run(undefined, { onPayload: (value) => {
      const payload = value as Record<string, unknown>;
      return { ...payload, safety_check: { level: "high" }, messages: [{ role: "latest_reminder", content: "旧提醒" }, ...(payload.messages as unknown[])] };
    } });
    expect(fixture.requests[0].body.safety_check).toBeUndefined();
    expect(JSON.stringify(fixture.requests[0].body.messages)).not.toContain("latest_reminder");
    expect(fixture.requests[0].body.title).toEqual({ enabled: true });
    expect(fixture.requests[0].body.tools).toEqual([{ type: "deepseek_web_search" }, { type: "deepseek_read_url" }]);
  });

  it.each([[true, false], [false, true]])("keeps reminder=%s and safety=%s independently configurable", async (deepseekLatestReminder, deepseekSafetyCheck) => {
    const fixture = harness([chunk({ content: "回答" }, "stop")], baseModel, "fixture-key", () => ({ deepseekLatestReminder, deepseekSafetyCheck }));
    await fixture.run();
    expect(fixture.requests[0].body.safety_check).toEqual(deepseekSafetyCheck ? { level: "high" } : undefined);
    expect(JSON.stringify(fixture.requests[0].body.messages).includes("latest_reminder")).toBe(deepseekLatestReminder);
  });

  it("reads preference changes for each request without rebuilding the session wrapper", async () => {
    let prefs: ChatbotPrefs = { deepseekLatestReminder: false, deepseekSafetyCheck: false };
    const getPrefs = vi.fn(() => prefs);
    const fixture = harness([chunk({ content: "回答" }, "stop")], baseModel, "fixture-key", getPrefs);
    for (const next of [
      { deepseekLatestReminder: false, deepseekSafetyCheck: false },
      { deepseekLatestReminder: true, deepseekSafetyCheck: false },
      { deepseekLatestReminder: false, deepseekSafetyCheck: true },
      { deepseekLatestReminder: false, deepseekSafetyCheck: false },
    ]) { prefs = next; await fixture.run(); }
    expect(getPrefs).toHaveBeenCalledTimes(4);
    expect(fixture.requests.map(({ body }) => [JSON.stringify(body.messages).includes("latest_reminder"), body.safety_check !== undefined])).toEqual([
      [false, false], [true, false], [false, true], [false, false],
    ]);
  });

  it("uses native tools only when active, retaining ordinary functions and existing callbacks", async () => {
    const fixture = harness([chunk({ content: "回答", title: "会话标题" }, "stop")], baseModel, "fixture-key", allChatbotPrefs);
    const onPayload = vi.fn((payload) => ({ ...payload, trace: true }));
    const onProviderStreamEvent = vi.fn();
    const result = await fixture.run({ messages: [user()], tools: [tool("web_search"), tool("read")] }, { reasoning: "high", onPayload, onProviderStreamEvent });
    expect(fixture.requests[0].body).toMatchObject({ trace: true, safety_check: { level: "high" }, title: { enabled: true }, thinking: { type: "enabled" } });
    expect(fixture.requests[0].body.tools).toEqual([expect.objectContaining({ type: "function", function: expect.objectContaining({ name: "read" }) }), { type: "deepseek_web_search" }]);
    expect(getDeepSeekResponseTitle(result.message)).toBe("会话标题");
    expect(onPayload).toHaveBeenCalledOnce();
    expect(onProviderStreamEvent).toHaveBeenCalledOnce();
    expect(fixture.requests[0].body.messages).toEqual(expect.arrayContaining([{ role: "latest_reminder", content: "2026-11-16,星期一,,App,中文" }]));
    const disabled = harness([chunk({ content: "回答" }, "stop")]);
    await disabled.run({ messages: [user()], tools: [tool("read")] });
    expect(JSON.stringify(disabled.requests[0].body.tools)).not.toContain("deepseek_web_search");
    expect(JSON.stringify(disabled.requests[0].body.tools)).not.toContain("deepseek_read_url");
  });

  it.each(["openai-completions", "anthropic-messages"])("retains per-user reminder prefixes across two turns and a %s client tool continuation", async (api) => {
    const model = { ...baseModel, api, baseUrl: api === "anthropic-messages" ? "https://api.deepseek.com/anthropic" : baseModel.baseUrl };
    /** Produce either a normal answer or one native client function call through the real adapter. */
    const events = (call: boolean) => api === "anthropic-messages" ? [
      { type: "message_start", message: { id: "msg-reminder", model: "deepseek-flash", usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: call ? { type: "tool_use", id: "read-reminder", name: "read", input: {} } : { type: "text", text: "回答" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: call ? "tool_use" : "end_turn" }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ] : [chunk(call ? { tool_calls: [{ index: 0, id: "read-reminder", type: "function", function: { name: "read", arguments: "{}" } }] } : { content: "回答" }, call ? "tool_calls" : "stop")];
    const firstUser = user("第一轮");
    const secondUser = { ...user("第二轮"), timestamp: new Date(2026, 10, 17, 12).getTime() };
    const first = harness(events(false), model, "fixture-key", reminderPrefs);
    const firstResult = await first.run({ messages: [firstUser], tools: [tool("read")] });
    const second = harness(events(true), model, "fixture-key", reminderPrefs);
    const secondResult = await second.run({ messages: [firstUser, firstResult.message, secondUser], tools: [tool("read")] });
    const continuation = harness(events(false), model, "fixture-key", reminderPrefs);
    await continuation.run({ messages: [firstUser, firstResult.message, secondUser, secondResult.message, {
      role: "toolResult", toolCallId: "read-reminder", toolName: "read", content: [{ type: "text", text: "文件内容" }], isError: false, timestamp: secondUser.timestamp + 1,
    }], tools: [tool("read")] });
    const firstWire = first.requests[0].body.messages as Record<string, unknown>[];
    const secondWire = second.requests[0].body.messages as Record<string, unknown>[];
    const continuedWire = continuation.requests[0].body.messages as Record<string, unknown>[];
    /** Ignore Pi's moving Anthropic cache-control breakpoint when comparing the logical prompt prefix. */
    const prefix = (messages: Record<string, unknown>[]) => messages.map((message) => {
      if (!Array.isArray(message.content)) return message;
      const content = message.content.map(({ cache_control: _cache, ...block }) => block);
      return { ...message, content: content.length === 1 && content[0].type === "text" ? content[0].text : content };
    });
    expect(prefix(secondWire.slice(0, firstWire.length))).toEqual(prefix(firstWire));
    expect(prefix(continuedWire.slice(0, secondWire.length))).toEqual(prefix(secondWire));
    expect(continuedWire.filter((message) => message.role === "latest_reminder")).toEqual([
      { role: "latest_reminder", content: "2026-11-16,星期一,,App,中文" },
      { role: "latest_reminder", content: "2026-11-17,星期二,,App,中文" },
    ]);
    expect(continuedWire.at(-2)?.role).toBe("assistant");
    expect(continuedWire.at(-1)?.role).toBe(api === "anthropic-messages" ? "user" : "tool");
  });

  it("skips unmatched native user text instead of assigning a different user's reminder", async () => {
    const fixture = harness([chunk({ content: "答复" }, "stop")], baseModel, "fixture-key", reminderPrefs);
    await fixture.run({ messages: [user("原始用户内容")] }, { onPayload: (value) => ({ ...value as Record<string, unknown>, messages: [{ role: "user", content: "由协议层合并后的不匹配内容" }] }) });
    expect(JSON.stringify(fixture.requests[0].body.messages)).not.toContain("latest_reminder");
  });

  it("persists exact OpenAI server calls, replays them on the next turn and renders Unicode citation indices", async () => {
    const serverCalls = [{ index: 0, reasoning_content: "", calls: [{ index: 0, id: "srvtoolu_fixture", type: "deepseek_read_url", kind: "read_link", action: { type: "read_link", url: "https://example.com" }, status: "completed", signature: "opaque-signature" }] }];
    const annotations = [{ type: "url_citation", url_citation: { url: "https://example.com/source", title: "来源", start_index: 0, end_index: 2 } }];
    const fixture = harness([chunk({ reasoning_content: "推理" }), chunk({ content: "A😀B" }), chunk({ server_tool_calls: serverCalls, annotations, title: "标题" }, "stop", { prompt_tokens: 42, completion_tokens: 9, total_tokens: 51 })]);
    const { message } = await fixture.run();
    expect(message.content).toContainEqual({ type: "text", text: "A😀 [1](https://example.com/source)B" });
    expect(message.usage).toMatchObject({ input: 42, output: 9, totalTokens: 51 });
    const directory = mkdtempSync(join(tmpdir(), "x-agent-chatbot-"));
    try {
      const manager = SessionManager.create(directory, directory);
      manager.appendMessage(user());
      manager.appendMessage(message);
      const restored = SessionManager.open(manager.getSessionFile()!).buildSessionContext().messages;
      const next = harness([chunk({ content: "下一轮" }, "stop")]);
      await next.run({ messages: [...restored, user("继续")], tools: [] });
      const body = next.requests[0].body;
      expect(body.title).toBeUndefined();
      expect((body.messages as Record<string, unknown>[]).find((entry) => entry.role === "assistant")).toMatchObject({ content: "A😀B", server_tool_calls: serverCalls, annotations });
      expect(JSON.stringify(body)).not.toContain("opaque-signatureopaque-signature");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("delegates every noneligible model unchanged except for private document markers", async () => {
    const original = vi.fn<StreamFn>();
    const sentinel = {} as Awaited<ReturnType<StreamFn>>;
    original.mockReturnValue(sentinel);
    const wrapped = wrapDeepSeekChatbotStream(original);
    const content = encodeDeepSeekDocument({ id: "file-fixture", name: "资料.pdf", provider: "deepseek", purpose: "text_recognition", authScope });
    const model = { ...baseModel, id: "other-model" };
    const options = { reasoning: "high" as const };
    expect(await wrapped(model, normalizeContext({ messages: [user(content)] }), options)).toBe(sentinel);
    expect(original).toHaveBeenCalledWith(model, expect.any(Object), options);
    expect(JSON.stringify(original.mock.calls[0][1])).not.toContain("file-fixture");
    expect(JSON.stringify(original.mock.calls[0][1])).toContain("资料.pdf");
  });

  it("keeps prior raw metadata off another provider's wire payload", async () => {
    const first = harness([chunk({ content: "答复", server_tool_calls: [{ signature: "provider-private" }] }, "stop")]);
    const { message } = await first.run();
    const getPrefs = vi.fn(allChatbotPrefs);
    const other = harness([chunk({ content: "其他回答" }, "stop")], { ...baseModel, provider: "another", baseUrl: "https://example.com/v1" }, "fixture-key", getPrefs);
    await other.run({ messages: [user(), message, user("继续")], tools: [tool("web_search")] });
    expect(JSON.stringify(other.requests[0].body)).not.toContain("provider-private");
    expect(other.requests[0].body.safety_check).toBeUndefined();
    expect(other.requests[0].body.title).toBeUndefined();
    expect(JSON.stringify(other.requests[0].body.messages)).not.toContain("latest_reminder");
    expect(getPrefs).not.toHaveBeenCalled();
    expect(JSON.stringify(other.requests[0].body.tools)).toContain('"name":"web_search"');
  });

  it("rechecks resolved runtime endpoints before adding feature payloads or beta headers", async () => {
    const requests: { body: Record<string, unknown>; headers: Headers }[] = [];
    const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      requests.push({ body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
      return sse([
        { type: "message_start", message: { id: "msg", model: "deepseek-flash", usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "回答" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      ], true);
    });
    const selected = { ...baseModel, api: "anthropic-messages", baseUrl: "https://api.deepseek.com/anthropic" };
    const actual = { ...selected, baseUrl: "https://proxy.example/anthropic" } as Model<"anthropic-messages">;
    const original: StreamFn = (_model, context, options) => anthropicStream(actual, context, { ...options, apiKey: "fixture" });
    const marker = encodeDeepSeekDocument({ id: "file-private", name: "文档.pdf", provider: "deepseek", purpose: "text_recognition", authScope });
    const stream = await wrapDeepSeekChatbotStream(original)(selected, normalizeContext({ messages: [user(marker)], tools: [tool("web_search")] }), { fetch });
    for await (const _event of stream) { /* Drain the complete native adapter response. */ }
    expect((await stream.result() as AssistantMessage & { deepseekChatbot?: unknown }).deepseekChatbot).toBeUndefined();
    expect(requests[0].headers.get("anthropic-beta")).toBeNull();
    expect(requests[0].body.safety_check).toBeUndefined();
    expect(requests[0].body.title).toBeUndefined();
    expect(JSON.stringify(requests[0].body)).not.toContain("file-private");
    expect(JSON.stringify(requests[0].body.tools)).not.toContain("deepseek_web_search");
  });

  it("ignores empty refusal markers and unsafe source URLs without corrupting the native text", async () => {
    const fixture = harness([chunk({ content: "正常回答", refusal: "", annotations: [{ type: "url_citation", url_citation: { url: "javascript:alert(1)", end_index: 2 } }] }, "stop")]);
    const { message } = await fixture.run();
    expect(message.content).toContainEqual({ type: "text", text: "正常回答" });
    expect(message.stopReason).toBe("stop");
  });

  it("merges index-addressed server fragments, distinct annotations and final server tool usage", async () => {
    const call = { index: 0, id: "srvtoolu_0", type: "deepseek_read_url", signature: "signature-0" };
    const one = { type: "url_citation", url_citation: { url: "https://example.com/one", end_index: 1 } };
    const two = { type: "url_citation", url_citation: { url: "https://example.com/two", end_index: 2 } };
    const fixture = harness([
      chunk({ content: "AB", server_tool_calls: [{ index: 0, calls: [call] }], annotations: [one] }),
      chunk({ server_tool_calls: [{ index: 0, calls: [{ index: 1, id: "srvtoolu_1", signature: "signature-1" }] }, { index: 1, calls: [] }], annotations: [one, two] }, "stop",
        { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, server_tool_use: { tool_search: 2, tool_fetch: 1, tool_image_search: 0 } }),
    ]);
    const { message } = await fixture.run();
    const metadata = (message as AssistantMessage & { deepseekChatbot: Record<string, unknown> }).deepseekChatbot;
    expect(metadata.serverToolCalls).toEqual([{ index: 0, calls: [call, { index: 1, id: "srvtoolu_1", signature: "signature-1" }] }, { index: 1, calls: [] }]);
    expect(metadata.annotations).toEqual([one, two]);
    expect(metadata.serverToolUsage).toEqual({ tool_search: 2, tool_fetch: 1, tool_image_search: 0 });
  });

  it("keeps compaction and branch summary requests on Pi's original path", async () => {
    const original = vi.fn<StreamFn>().mockReturnValue({} as Awaited<ReturnType<StreamFn>>);
    const options = { sessionId: "summary-request" };
    const context = normalizeContext({ messages: [user("总结")] });
    await wrapDeepSeekChatbotStream(original, "conversation-id")(baseModel, context, options);
    expect(original).toHaveBeenCalledWith(baseModel, context, options);
  });

  it.each(["openai-completions", "anthropic-messages"])("checks uploaded document account scope at the final %s HTTP boundary", async (api) => {
    const model = { ...baseModel, api, baseUrl: api === "anthropic-messages" ? "https://api.deepseek.com/anthropic/v1" : baseModel.baseUrl };
    const events = api === "anthropic-messages" ? [
      { type: "message_start", message: { id: "msg", model: "deepseek-flash", usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "答复" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ] : [chunk({ content: "答复" }, "stop")];
    const fixture = harness(events, model);
    const document = { id: "file-account-private", name: "account.pdf", provider: model.provider, purpose: "text_recognition" as const, authScope };
    await fixture.run({ messages: [user(encodeDeepSeekDocument(document))] });
    const sent = JSON.stringify(fixture.requests[0].body);
    expect(sent).toContain('"file_id":"file-account-private"');
    expect(sent).not.toContain("x_agent_auth_scope");
    expect(sent).not.toContain(authScope);
    if (api === "anthropic-messages") {
      expect(new URL(fixture.requests[0].url).pathname).toBe("/anthropic/v1/messages");
      expect(fixture.requests[0].headers.get("anthropic-beta")).toContain("files-api-2025-04-14");
    }
    const mismatch = harness(events, model);
    await mismatch.run({ messages: [user(encodeDeepSeekDocument({ ...document, authScope: "0".repeat(64) }))] });
    expect(JSON.stringify(mismatch.requests[0].body)).not.toContain("file-account-private");
    expect(JSON.stringify(mismatch.requests[0].body)).toContain("请重新上传");
  });

  it("removes converted files from redirected requests even when their stored scope matches", () => {
    const content = [{ type: "file", file_id: "file-0", x_agent_auth_scope: authScope }, { type: "document", source: { type: "file", file_id: "file-1" }, x_agent_auth_scope: authScope }, { type: "image", source: { type: "file", file_id: "file-2" }, x_agent_auth_scope: authScope }];
    const safe = sanitizeDeepSeekFilePayload({ messages: [{ role: "user", content }] }, authScope, false);
    expect(JSON.stringify(safe)).not.toContain("file_id");
    expect(JSON.stringify(safe)).not.toContain("x_agent_auth_scope");
    expect(JSON.stringify(safe)).not.toContain(authScope);
  });

  it("does not replay encrypted server signatures after a provider account key rotates", async () => {
    const first = harness([chunk({ content: "可读回答", server_tool_calls: [{ index: 0, calls: [{ index: 0, signature: "account-one-signature" }] }] }, "stop")]);
    const { message } = await first.run();
    const next = harness([chunk({ content: "新账号回答" }, "stop")], baseModel, "account-two-key");
    await next.run({ messages: [user(), JSON.parse(JSON.stringify(message)) as AssistantMessage, user("继续")], tools: [] });
    const wire = JSON.stringify(next.requests[0].body);
    expect(wire).toContain("可读回答");
    expect(wire).not.toContain("account-one-signature");
    expect(wire).not.toContain("x_agent_deepseek_response_scope");
    expect(wire).not.toContain(authScope);
  });

  it.each([
    [true, "file_not_found: File 'file-fixture' not found", true],
    [true, "invalid file id", true],
    [true, "API key is invalid", false],
    [false, "file_not_found: File 'file-fixture' not found", false],
  ])("adds file recovery guidance only for referenced document failures (%s, %s)", async (withDocument, error, explain) => {
    const fixture = harness([]);
    const marker = encodeDeepSeekDocument({ id: "file-fixture", name: "资料.pdf", provider: "deepseek", purpose: "text_recognition", authScope });
    const { message } = await fixture.run({ messages: [user(withDocument ? marker : "普通问题")] }, { fetch: async () => new Response(JSON.stringify({ error: { message: error, type: "invalid_request_error" } }), { status: 400, headers: { "content-type": "application/json" } }) });
    expect(message.stopReason).toBe("error");
    expect(message.errorMessage?.includes("请撤回含该文档的消息")).toBe(explain);
  });

  it("replaces filtered partial text/thinking, preserves server signatures and does not return retryable errors", async () => {
    const fixture = harness([chunk({ reasoning_content: "不应保留的推理" }), chunk({ content: "不应保留的正文" }), chunk({ server_tool_calls: [{ signature: "opaque" }], refusal: "blocked" }, "content_filter", { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 })]);
    const { message, updates } = await fixture.run();
    expect(fixture.requests[0].body.safety_check).toBeUndefined();
    expect(message.stopReason).toBe("stop");
    expect(message.errorMessage).toBeUndefined();
    expect(JSON.stringify(message)).not.toContain("不应保留");
    expect(JSON.stringify(message)).toContain("opaque");
    expect(message.content).toEqual([{ type: "text", text: expect.stringContaining("内容安全审核") }]);
    expect(message.usage.totalTokens).toBe(11);
    expect(updates.at(-1)?.type).toBe("done");
  });

  it("treats HTTP 200 terminal provider errors as failures while retaining reported usage", async () => {
    const fixture = harness([chunk({ content: "未完成" }, "stop"), { error: { message: "server failed" }, choices: [], usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 } }]);
    const { message } = await fixture.run();
    expect(message.stopReason).toBe("error");
    expect(message.errorMessage).toContain("服务端生成失败");
    expect(message.usage.totalTokens).toBe(24);
  });

  it("keeps Messages server blocks, thinking signatures, citations and client tool input across reload", async () => {
    const model = { ...baseModel, api: "anthropic-messages", baseUrl: "https://api.deepseek.com/anthropic", provider: "deepseek-anthropic" };
    const server = { type: "server_tool_use", id: "srvtoolu_1", name: "deepseek_read_url", input: { action: "read_link", url: "https://example.com" }, kind: "read_link" };
    const result = { type: "web_fetch_tool_result", tool_use_id: "srvtoolu_1", content: { type: "web_fetch_result", url: "https://example.com" }, signature: "fetch-signature", kind: "read_link" };
    const citation = { type: "web_search_result_location", url: "https://example.com", title: "Example", encrypted_index: "", cited_text: "正文" };
    const events = [
      { type: "message_start", message: { id: "msg_fixture", model: "deepseek-flash", usage: { input_tokens: 10, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "思考" } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "thinking-signature" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: server }, { type: "content_block_stop", index: 1 },
      { type: "content_block_start", index: 2, content_block: result }, { type: "content_block_stop", index: 2 },
      { type: "content_block_start", index: 3, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 3, delta: { type: "text_delta", text: "正文" } },
      { type: "content_block_delta", index: 3, delta: { type: "citations_delta", citation } },
      { type: "content_block_stop", index: 3 },
      { type: "content_block_start", index: 4, content_block: { type: "tool_use", id: "client_1", name: "read", input: {} } },
      { type: "content_block_delta", index: 4, delta: { type: "input_json_delta", partial_json: '{"path":"file.txt"}' } },
      { type: "content_block_stop", index: 4 },
      { type: "message_delta", delta: { stop_reason: "tool_use", title: "Messages 标题" }, usage: { input_tokens: 28, output_tokens: 12, cache_read_input_tokens: 4 } },
      { type: "message_stop" },
    ];
    const fixture = harness(events, model);
    const { message } = await fixture.run({ messages: [user()], tools: [tool("web_fetch"), tool("read")] }, { reasoning: "high", headers: { "anthropic-beta": "existing-beta" } });
    expect(message.stopReason).toBe("toolUse");
    expect(message.content).toContainEqual(expect.objectContaining({ type: "toolCall", name: "read", arguments: { path: "file.txt" } }));
    expect(message.content).toContainEqual({ type: "text", text: "正文 [1](https://example.com/)" });
    expect(message.usage).toMatchObject({ input: 28, output: 12, cacheRead: 4 });
    expect(getDeepSeekResponseTitle(message)).toBe("Messages 标题");
    expect(fixture.requests[0].headers.get("anthropic-beta")).toContain("existing-beta");
    expect(fixture.requests[0].headers.get("anthropic-beta")).toContain("files-api-2025-04-14");
    const restored = JSON.parse(JSON.stringify(message)) as AssistantMessage;
    const next = harness(events, model);
    await next.run({ messages: [user(), restored, { role: "toolResult", toolCallId: "client_1", toolName: "read", isError: false, content: [{ type: "text", text: "file" }], timestamp }, user("继续")], tools: [tool("read")] });
    const assistant = (next.requests[0].body.messages as Record<string, unknown>[]).find((entry) => entry.role === "assistant");
    expect(assistant?.content).toEqual([{ type: "thinking", thinking: "思考", signature: "thinking-signature" }, server, result, { type: "text", text: "正文", citations: [citation] }, { type: "tool_use", id: "client_1", name: "read", input: { path: "file.txt" } }]);
    expect(JSON.stringify(next.requests[0].body.tools)).not.toContain("deepseek_read_url");
  });
});
