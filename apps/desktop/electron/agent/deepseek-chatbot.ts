/** Preserve DeepSeek application response data around Pi's native adapters without changing other providers. */
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createHash } from "node:crypto";
import type { AssistantMessage, Model, Api, TranscriptContext } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import { supportsDeepSeekChatbot } from "../../shared/deepseek-capabilities";
import { DEFAULT_PREFS, type ClientPrefs } from "../../shared/ipc";
import { prepareDeepSeekDocumentPayload, stripDeepSeekDocumentContext, stripDeepSeekDocumentText } from "../../shared/deepseek-documents";

type Row = Record<string, unknown>;
type ChatbotModel = Model<Api>;
type ChatbotPrefs = Pick<ClientPrefs, "deepseekLatestReminder" | "deepseekSafetyCheck">;
type ChatbotMetadata = {
  version: 1;
  provider: string;
  model: string;
  api: string;
  baseUrl: string;
  authScope?: string;
  originalText: string;
  rawBlocks?: Row[];
  serverToolCalls?: unknown[];
  annotations?: unknown[];
  serverToolUsage?: Row;
  title?: string;
  refused?: boolean;
};
type ChatbotMessage = AssistantMessage & { deepseekChatbot?: ChatbotMetadata };
const REFUSAL_TEXT = "抱歉，当前请求未通过内容安全审核，请调整问题后重试。";
const SERVER_BLOCKS = new Set(["server_tool_use", "web_search_tool_result", "web_fetch_tool_result"]);

/** Narrow untyped provider events without trusting their shape. */
function row(value: unknown): Row | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

/** Keep the stored payload independent from SDK event objects and later renderer projections. */
function copy<T>(value: T): T {
  return structuredClone(value);
}

/** Read display text only; encrypted server results never become UI text. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.map((part) => row(part)).filter((part) => part?.type === "text")
    .map((part) => typeof part?.text === "string" ? part.text : "").join("") : "";
}

/** Bind opaque replay data to the original provider, model, protocol and official endpoint. */
function replayMetadata(message: unknown, model: ChatbotModel): ChatbotMetadata | null {
  const source = row(message);
  const metadata = row(source?.deepseekChatbot);
  if (!metadata || metadata.version !== 1 || metadata.provider !== model.provider || metadata.model !== model.id ||
      metadata.api !== model.api || !supportsDeepSeekChatbot({ id: model.id, api: model.api, baseUrl: String(metadata.baseUrl) })) return null;
  return metadata as ChatbotMetadata;
}

/** Expose only the generated title to the host; opaque server data remains in the main-process session. */
export function getDeepSeekResponseTitle(message: unknown): string | null {
  const metadata = row(row(message)?.deepseekChatbot);
  return metadata?.version === 1 && typeof metadata.title === "string" && metadata.title.trim()
    ? metadata.title.trim().slice(0, 256) : null;
}

/** Match the normalized wire assistant to its canonical session message, including tool-only turns. */
function matchingAssistant(wire: Row, candidates: AssistantMessage[], model: ChatbotModel): number {
  const wireText = textOf(wire.content);
  const wireCalls = Array.isArray(wire.tool_calls) ? wire.tool_calls.map((call) => row(call)?.id) :
    Array.isArray(wire.content) ? wire.content.map((block) => row(block)).filter((block) => block?.type === "tool_use").map((block) => block?.id) : [];
  return candidates.findIndex((message) => {
    const calls = message.content.filter((block) => block.type === "toolCall");
    if (!wireText && calls.length === 0) {
      const wireThinking = typeof wire.reasoning_content === "string" ? wire.reasoning_content :
        Array.isArray(wire.content) ? wire.content.map((part) => row(part)).filter((part) => part?.type === "thinking").map((part) => part?.thinking ?? "").join("") : "";
      const sourceThinking = message.provider === model.provider && message.model === model.id && message.api === model.api
        ? message.content.filter((part) => part.type === "thinking").map((part) => part.thinking).join("") : "";
      if (wireThinking !== sourceThinking) return false;
    }
    return wireText === textOf(message.content) && calls.length === wireCalls.length &&
      calls.every((call, index) => call.id === wireCalls[index]);
  });
}

/** Reinsert raw native history only where Pi retained the corresponding canonical assistant message. */
function restoreHistory(payload: Row, context: TranscriptContext, model: ChatbotModel): void {
  if (!Array.isArray(payload.messages)) return;
  const candidates = context.messages.filter((message): message is AssistantMessage => message.role === "assistant" &&
    message.stopReason !== "error" && message.stopReason !== "aborted");
  for (const value of payload.messages) {
    const wire = row(value);
    if (wire?.role !== "assistant") continue;
    const index = matchingAssistant(wire, candidates, model);
    if (index < 0) continue;
    const source = candidates[index];
    candidates.splice(0, index + 1);
    const metadata = replayMetadata(source, model);
    if (!metadata) continue;
    if (model.api === "anthropic-messages" && Array.isArray(metadata.rawBlocks) && metadata.rawBlocks.length) {
      wire.content = copy(metadata.rawBlocks);
    } else if (model.api === "openai-completions") {
      wire.content = metadata.originalText;
      if (metadata.serverToolCalls) wire.server_tool_calls = copy(metadata.serverToolCalls);
      if (metadata.annotations) wire.annotations = copy(metadata.annotations);
    }
    wire.x_agent_deepseek_response_scope = metadata.authScope ?? "unscoped";
  }
}

/** Rebuild stable reminders for matching user inputs so history and tool continuations retain the same prefix. */
function addLatestReminder(payload: Row, context: TranscriptContext): void {
  if (!Array.isArray(payload.messages)) return;
  const users = context.messages.filter((message) => message.role === "user");
  const messages: unknown[] = [];
  let cursor = 0;
  for (const value of payload.messages) {
    const wireUser = row(value);
    if (wireUser?.role === "latest_reminder") continue;
    const toolResult = Array.isArray(wireUser?.content) && wireUser.content.some((block) => row(block)?.type === "tool_result");
    if (wireUser?.role === "user" && !toolResult) {
      const text = textOf(wireUser.content);
      const index = users.findIndex((message, index) => index >= cursor && textOf(message.content) === text);
      if (index >= 0) {
        const date = new Date(users[index].timestamp);
        cursor = index + 1;
        if (Number.isFinite(date.getTime())) {
          const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
          const weekday = "日一二三四五六"[date.getDay()];
          messages.push({ role: "latest_reminder", content: `${stamp},星期${weekday},,App,中文` });
        }
      }
    }
    messages.push(value);
  }
  payload.messages = messages;
}

/** Replace the opted-in local web declarations with native server tools using the effective request loadout. */
function preparePayload(value: unknown, context: TranscriptContext, model: ChatbotModel, prefs: ChatbotPrefs, reasoning?: string): unknown {
  const original = row(value);
  if (!original) return value;
  const payload = copy(original);
  const actualTools = new Set(getCurrentTools(context.messages).map((tool) => tool.name));
  const enabled = new Set<string>();
  if (Array.isArray(payload.tools)) {
    payload.tools = payload.tools.filter((value) => {
      const tool = row(value);
      const name = typeof tool?.name === "string" ? tool.name : row(tool?.function)?.name;
      if ((name === "web_search" || name === "web_fetch") && actualTools.has(name)) enabled.add(name);
      return name !== "web_search" && name !== "web_fetch" && tool?.type !== "deepseek_web_search" && tool?.type !== "deepseek_read_url";
    });
  }
  const tools = Array.isArray(payload.tools) ? payload.tools : [];
  for (const name of enabled) {
    const type = name === "web_search" ? "deepseek_web_search" : "deepseek_read_url";
    tools.push(model.api === "anthropic-messages" ? { type, name: type } : { type });
  }
  if (tools.length) payload.tools = tools;
  else delete payload.tools;
  if (prefs.deepseekSafetyCheck === true) payload.safety_check = { level: "high" };
  else delete payload.safety_check;
  if (!context.messages.some((message) => message.role === "assistant")) payload.title = { enabled: true };
  else delete payload.title;
  payload.thinking = { type: reasoning && reasoning !== "off" ? "enabled" : "disabled" };
  restoreHistory(payload, context, model);
  if (prefs.deepseekLatestReminder === true) addLatestReminder(payload, context);
  else if (Array.isArray(payload.messages)) payload.messages = payload.messages.filter((message) => row(message)?.role !== "latest_reminder");
  return prepareDeepSeekDocumentPayload(payload, model);
}

/** Strip remote file markers if runtime authentication redirects the original selection to another endpoint. */
function stripPayloadDocuments(value: unknown): unknown {
  const payload = row(value);
  if (!payload || !Array.isArray(payload.messages)) return value;
  return { ...payload, messages: payload.messages.map((value) => {
    const message = row(value);
    if (message?.role !== "user") return value;
    return { ...message, content: typeof message.content === "string" ? stripDeepSeekDocumentText(message.content) :
      Array.isArray(message.content) ? message.content.map((part) => {
        const block = row(part);
        return block?.type === "text" && typeof block.text === "string" ? { ...block, text: stripDeepSeekDocumentText(block.text) } : part;
      }) : message.content };
  }) };
}

/** Keep terminal error usage visible because OpenAI's SDK throws before yielding chunks with an error member. */
function errorUsageStream(body: ReadableStream<Uint8Array>, onError: () => void): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  /** Rewrite only error events; normal frames and their provider extensions pass through verbatim. */
  const frame = (value: string): string => {
    const data = value.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    try {
      const event = row(JSON.parse(data));
      if (!event?.error) return value;
      onError();
      return `data: ${JSON.stringify({ ...event, error: undefined, choices: [{ index: 0, delta: {}, finish_reason: "network_error" }] })}`;
    } catch { return value; }
  };
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(bytes, controller) {
      buffer = (buffer + decoder.decode(bytes, { stream: true })).replace(/\r\n/g, "\n");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        controller.enqueue(encoder.encode(frame(buffer.slice(0, end)) + "\n\n"));
        buffer = buffer.slice(end + 2);
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer) controller.enqueue(encoder.encode(frame(buffer) + "\n\n"));
    },
  }));
}

/** Require the upload account's credential fingerprint and remove local scope data before transmitting files. */
export function sanitizeDeepSeekFilePayload(value: unknown, authScope: string | null, official: boolean): unknown {
  const payload = row(value);
  if (!payload || !Array.isArray(payload.messages)) return value;
  return { ...payload, messages: payload.messages.map((value) => {
    const message = row(value);
    if (message?.role !== "user" || !Array.isArray(message.content)) return value;
    return { ...message, content: message.content.map((value) => {
      const block = row(value);
      if (!block) return value;
      const source = row(block.source);
      const hasFile = typeof block.file_id === "string" || (source?.type === "file" && typeof source.file_id === "string");
      if (!hasFile) return value;
      if (!official || !authScope || block.x_agent_auth_scope !== authScope) return { type: "text", text: "[附件已属于其他 DeepSeek 账号，请重新上传]" };
      const { x_agent_auth_scope: _scope, ...native } = block;
      return native;
    }) };
  }) };
}

/** Keep encrypted page/thinking data within its originating account when a provider's API key rotates. */
function sanitizeReplayScope(value: unknown, authScope: string | null, official: boolean): unknown {
  const payload = row(value);
  if (!payload || !Array.isArray(payload.messages)) return value;
  return { ...payload, messages: payload.messages.map((value) => {
    const message = row(value);
    if (message?.role !== "assistant" || !message.x_agent_deepseek_response_scope) return value;
    const { x_agent_deepseek_response_scope: scope, ...native } = message;
    if (official && authScope && scope === authScope) return native;
    delete native.server_tool_calls;
    delete native.reasoning_content;
    if (Array.isArray(native.content)) native.content = native.content.flatMap((value) => {
      const block = row(value);
      if (block?.type === "tool_use") return [value];
      return block?.type === "text" ? [{ type: "text", text: String(block.text ?? "") }] : [];
    });
    return native;
  }) };
}

/** Derive the same account fingerprint used by uploads from the headers the SDK will actually send. */
function requestAuthScope(headers: Headers): string | null {
  const bearer = /^Bearer\s+(.+)$/i.exec(headers.get("authorization") ?? "")?.[1]?.trim();
  const key = bearer || headers.get("x-api-key")?.trim();
  return key ? createHash("sha256").update("x-agent-deepseek-files\0").update(key).digest("hex") : null;
}

/** Extend transport only after the SDK resolves the physical official endpoint, retaining SDK auth and retries. */
function chatbotFetch(model: ChatbotModel, upstream: typeof fetch = globalThis.fetch, isActive: () => boolean, onScope: (scope: string | null) => void, onError: () => void): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const official = isActive() && url.origin === "https://api.deepseek.com" && (model.api === "anthropic-messages"
      ? ["/anthropic/v1/messages", "/anthropic/v1/v1/messages"].includes(url.pathname)
      : ["/chat/completions", "/v1/chat/completions"].includes(url.pathname));
    if (official && model.api === "anthropic-messages" && url.pathname === "/anthropic/v1/v1/messages") {
      url.pathname = "/anthropic/v1/messages";
      input = input instanceof Request ? new Request(url, input) : url;
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const authScope = requestAuthScope(headers);
    if (official) onScope(authScope);
    const body = typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : null;
    if (body && (body.includes('"file_id"') || body.includes("x_agent_deepseek_response_scope"))) {
      const sanitized = sanitizeReplayScope(sanitizeDeepSeekFilePayload(JSON.parse(body), authScope, official), authScope, official);
      headers.delete("content-length");
      init = { ...init, headers, body: JSON.stringify(sanitized) };
    }
    if (official && model.api === "anthropic-messages") {
      const tokens = new Set((headers.get("anthropic-beta") ?? "").split(",").map((token) => token.trim()).filter(Boolean));
      tokens.add("files-api-2025-04-14");
      headers.set("anthropic-beta", [...tokens].join(","));
      return upstream(input, { ...init, headers });
    }
    const response = await upstream(input, init);
    if (!official || model.api !== "openai-completions" || !response.ok || !response.body) return response;
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-length");
    responseHeaders.delete("content-encoding");
    return new Response(errorUsageStream(response.body, onError), { status: response.status, statusText: response.statusText, headers: responseHeaders });
  };
}

/** Merge index-addressed server steps without losing earlier signatures when extensions arrive in fragments. */
function mergeServerCalls(previous: unknown[], incoming: unknown[]): unknown[] {
  const merged = copy(previous);
  for (const value of incoming) {
    const next = row(value);
    if (!next) continue;
    const index = merged.findIndex((value) => row(value)?.index === next.index);
    if (index < 0) { merged.push(copy(next)); continue; }
    const current = row(merged[index])!;
    const calls = Array.isArray(current.calls) ? copy(current.calls) : [];
    for (const value of Array.isArray(next.calls) ? next.calls : []) {
      const call = row(value);
      if (!call) continue;
      const index = calls.findIndex((value) => row(value)?.index === call.index);
      if (index < 0) calls.push(copy(call));
      else calls[index] = { ...row(calls[index]), ...copy(call) };
    }
    merged[index] = { ...current, ...copy(next), ...(Array.isArray(next.calls) || Array.isArray(current.calls) ? { calls } : {}) };
  }
  return merged;
}

/** Keep distinct citation fragments while ignoring exact repetitions of the final annotations array. */
function mergeAnnotations(previous: unknown[], incoming: unknown[]): unknown[] {
  const result = copy(previous);
  const known = new Set(result.map((value) => JSON.stringify(value)));
  for (const annotation of incoming) {
    const key = JSON.stringify(annotation);
    if (!known.has(key)) { result.push(copy(annotation)); known.add(key); }
  }
  return result;
}

/** Render only validated public source links; provider titles and URLs cannot inject Markdown structure. */
function citationLink(value: unknown, number: number): string | null {
  const source = row(value);
  const citation = row(source?.url_citation) ?? source;
  if (typeof citation?.url !== "string") return null;
  try {
    const url = new URL(citation.url);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    const href = url.href.replace(/[<>()\\\s]/g, (char) => encodeURIComponent(char));
    return ` [${number}](${href})`;
  } catch { return null; }
}

/** Apply OpenAI citation positions as Unicode code points, leaving opaque replay text unchanged. */
function renderAnnotations(text: string, annotations: unknown[]): string {
  const points = [...text];
  const insertions = new Map<number, string[]>();
  let number = 0;
  for (const annotation of annotations) {
    const citation = row(row(annotation)?.url_citation);
    if (!citation || !Number.isInteger(citation.end_index)) continue;
    const end = Number(citation.end_index);
    if (end < 0 || end > points.length) continue;
    const link = citationLink(annotation, number + 1);
    if (!link) continue;
    number++;
    insertions.set(end, [...(insertions.get(end) ?? []), link]);
  }
  let rendered = "";
  for (let i = 0; i <= points.length; i++) rendered += (insertions.get(i) ?? []).join("") + (points[i] ?? "");
  return rendered;
}

/** Collect raw Messages blocks independently from Pi's text/thinking/function-only projection. */
function collectMessages(event: Row, blocks: Map<number, Row>, inputs: Map<number, string>): void {
  const index = Number(event.index);
  if (event.type === "content_block_start" && Number.isInteger(index) && row(event.content_block)) {
    blocks.set(index, copy(event.content_block as Row));
  } else if (event.type === "content_block_delta") {
    const block = blocks.get(index);
    const delta = row(event.delta);
    if (!block || !delta) return;
    if (delta.type === "text_delta" && typeof delta.text === "string") block.text = String(block.text ?? "") + delta.text;
    else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") block.thinking = String(block.thinking ?? "") + delta.thinking;
    else if (delta.type === "signature_delta" && typeof delta.signature === "string") block.signature = String(block.signature ?? "") + delta.signature;
    else if (delta.type === "citations_delta" && row(delta.citation)) block.citations = [...(Array.isArray(block.citations) ? block.citations : []), copy(delta.citation)];
    else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") inputs.set(index, (inputs.get(index) ?? "") + delta.partial_json);
  } else if (event.type === "content_block_stop" && inputs.has(index)) {
    const block = blocks.get(index);
    try { if (block) block.input = JSON.parse(inputs.get(index)!); } catch { /* Pi reports malformed client tool arguments. */ }
  }
}

/** Finalize safe display content and attach JSON-serializable replay data before Pi persists the assistant. */
function finalize(message: AssistantMessage, metadata: ChatbotMetadata, blocks: Map<number, Row>, failed: boolean): void {
  metadata.originalText = textOf(message.content);
  if (metadata.api === "anthropic-messages") metadata.rawBlocks = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block);
  if (metadata.refused) {
    message.content = [{ type: "text", text: REFUSAL_TEXT }];
    message.stopReason = "stop";
    delete message.errorMessage;
    metadata.originalText = REFUSAL_TEXT;
    delete metadata.annotations;
    if (metadata.rawBlocks) metadata.rawBlocks = [...metadata.rawBlocks.filter((block) => SERVER_BLOCKS.has(String(block.type))), { type: "text", text: REFUSAL_TEXT }];
  } else if (failed) {
    message.stopReason = "error";
    message.errorMessage = "DeepSeek 服务端生成失败，请稍后重试。";
  } else if (message.stopReason !== "aborted" && message.stopReason !== "error") {
    if (metadata.api === "openai-completions" && metadata.annotations?.length) {
      const rendered = renderAnnotations(metadata.originalText, metadata.annotations);
      message.content = [...message.content.filter((block) => block.type !== "text"), { type: "text", text: rendered }];
    } else if (metadata.rawBlocks?.some((block) => block.type === "text" && Array.isArray(block.citations))) {
      let number = 0;
      const rendered = metadata.rawBlocks.filter((block) => block.type === "text").map((block) => {
        const links = Array.isArray(block.citations) ? block.citations.map((citation) => citationLink(citation, ++number) ?? "").join("") : "";
        return String(block.text ?? "") + links;
      }).join("");
      message.content = [...message.content.filter((block) => block.type !== "text"), { type: "text", text: rendered }];
    }
  }
  (message as ChatbotMessage).deepseekChatbot = metadata;
}

/** Explain only explicit remote-file failures when this request actually contains persisted document references. */
function needsDocumentRecovery(context: TranscriptContext, error: string | undefined): boolean {
  if (!error || !/(?:file[_\s-]*not[_\s-]*found|invalid[_\s-]*file\b|\bfile(?:_id)?\b[^\n]{0,120}?(?:not found|does not exist|unavailable|deleted|invalid)|文件.{0,30}(?:不存在|已删除|不可用|无效))/i.test(error)) return false;
  return context.messages.some((message) => message.role === "user" && (typeof message.content === "string"
    ? message.content.includes("<deepseek_document>") : message.content.some((part) => part.type === "text" && part.text.includes("<deepseek_document>"))));
}

/** Wrap each physical request so model switching cannot activate DeepSeek extensions on a different service. */
export function wrapDeepSeekChatbotStream(original: StreamFn, expectedSessionId?: string, getPrefs: () => ChatbotPrefs = () => DEFAULT_PREFS): StreamFn {
  return (model, context, options) => {
    if (!supportsDeepSeekChatbot(model) || (expectedSessionId && options?.sessionId !== expectedSessionId)) return original(model, stripDeepSeekDocumentContext(context), options);
    const stream = createAssistantMessageEventStream();
    const metadata: ChatbotMetadata = { version: 1, provider: model.provider, model: model.id, api: model.api, baseUrl: model.baseUrl, originalText: "" };
    const blocks = new Map<number, Row>();
    const inputs = new Map<number, string>();
    let failed = false;
    let active = false;
    let settled = false;
    void (async () => {
      try {
        const source = await original(model, context, {
          ...options,
          fetch: chatbotFetch(model, options?.fetch, () => active, (scope) => { if (!settled && scope) metadata.authScope = scope; }, () => { if (!settled) failed = true; }),
          onPayload: async (payload, requestModel) => {
            const replacement = await options?.onPayload?.(payload, requestModel);
            active = supportsDeepSeekChatbot(requestModel);
            if (!active) return stripPayloadDocuments(replacement ?? payload);
            return preparePayload(replacement ?? payload, context, requestModel, getPrefs(), options?.reasoning);
          },
          onProviderStreamEvent: async (value, requestModel) => {
            await options?.onProviderStreamEvent?.(value, requestModel);
            if (settled || !active || !supportsDeepSeekChatbot(requestModel)) return;
            const event = row(value);
            if (!event) return;
            if (event.error) failed = true;
            const serverUsage = row(row(event.usage)?.server_tool_use);
            if (serverUsage) metadata.serverToolUsage = copy(serverUsage);
            if (model.api === "anthropic-messages") {
              collectMessages(event, blocks, inputs);
              const delta = row(event.delta);
              if (delta?.stop_reason === "refusal") metadata.refused = true;
              if (typeof delta?.title === "string") metadata.title = delta.title;
            } else {
              const choice = Array.isArray(event.choices) ? row(event.choices[0]) : null;
              const delta = row(choice?.delta);
              if (choice?.finish_reason === "content_filter" || (typeof delta?.refusal === "string" && delta.refusal.length > 0)) metadata.refused = true;
              if (Array.isArray(delta?.server_tool_calls)) metadata.serverToolCalls = mergeServerCalls(metadata.serverToolCalls ?? [], delta.server_tool_calls);
              if (Array.isArray(delta?.annotations)) metadata.annotations = mergeAnnotations(metadata.annotations ?? [], delta.annotations);
              if (typeof delta?.title === "string") metadata.title = delta.title;
            }
          },
        });
        for await (const event of source) {
          if (active && (event.type === "done" || event.type === "error")) {
            const message = event.type === "done" ? event.message : event.error;
            const missingDocument = needsDocumentRecovery(context, message.errorMessage);
            finalize(message, metadata, blocks, failed);
            if (missingDocument && message.stopReason === "error") message.errorMessage += "\n文档可能已删除或不可用，请撤回含该文档的消息并重新添加附件，或新建会话重新上传。";
            if (metadata.refused) stream.push({ type: "done", reason: "stop", message });
            else if (message.stopReason === "error") stream.push({ type: "error", reason: "error", error: message });
            else stream.push(event);
          } else stream.push(event);
        }
        settled = true;
        stream.end();
      } catch {
        settled = true;
        const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [], timestamp: Date.now(), stopReason: options?.signal?.aborted ? "aborted" : "error", errorMessage: options?.signal?.aborted ? "请求已取消。" : "DeepSeek 请求处理失败，请重试。", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        stream.push({ type: "error", reason: options?.signal?.aborted ? "aborted" : "error", error: message });
        stream.end();
      }
    })();
    return stream;
  };
}
