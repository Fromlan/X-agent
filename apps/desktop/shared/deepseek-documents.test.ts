/** Verify durable document references are protocol-correct and isolated when a conversation changes model. */
import { describe, expect, it } from "vitest";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { encodeDeepSeekDocument, prepareDeepSeekDocumentPayload, restoreEditedDeepSeekDocuments, stripDeepSeekDocumentContext, type DeepSeekDocument } from "./deepseek-documents";

const document: DeepSeekDocument = { id: "file-api-fixture", name: '设计<稿>".pdf', provider: "official", purpose: "rich_layout_recognition", authScope: "a".repeat(64) };
const model = { id: "deepseek-flash", provider: "official", api: "openai-completions", baseUrl: "https://api.deepseek.com" };
const marker = encodeDeepSeekDocument(document);

describe("DeepSeek document history", () => {
  it("preserves file chips across JSON persistence without embedding original document bytes", () => {
    const payload = JSON.parse(JSON.stringify({ messages: [{ role: "user", content: `总结\n${marker}` }] }));
    const result = prepareDeepSeekDocumentPayload(payload, model);
    expect(result).toMatchObject({ messages: [{ role: "user", content: [
      { type: "file", file_id: document.id, x_agent_auth_scope: document.authScope },
      { type: "text", text: `总结\n[附件：${document.name}]` },
    ] }] });
    expect(payload.messages[0].content).toBe(`总结\n${marker}`);
  });

  it("preserves tool_result ordering and image blocks on the Messages protocol", () => {
    const result = prepareDeepSeekDocumentPayload({ messages: [{ role: "user", content: [
      { type: "tool_result", tool_use_id: "call", content: "ok" },
      { type: "text", text: marker },
      { type: "image", source: { type: "base64", data: "fixture" } },
    ] }] }, { ...model, api: "anthropic-messages", baseUrl: "https://api.deepseek.com/anthropic" });
    expect(result).toMatchObject({ messages: [{ content: [
      { type: "tool_result", tool_use_id: "call" },
      { type: "document", source: { type: "file", file_id: document.id }, x_agent_auth_scope: document.authScope },
      { type: "text", text: `[附件：${document.name}]` },
      { type: "image" },
    ] }] });
  });

  it("does not send file identifiers to another provider with the same official model", () => {
    const result = prepareDeepSeekDocumentPayload({ messages: [{ role: "user", content: marker }] }, { ...model, provider: "other-account" });
    expect(JSON.stringify(result)).not.toContain(document.id);
    expect(JSON.stringify(result)).toContain("重新上传");
  });

  it("strips file identifiers before a non-DeepSeek adapter receives canonical history", () => {
    const context: TranscriptContext = { messages: [{ role: "user", timestamp: 1, content: [
      { type: "text", text: marker }, { type: "image", data: "image", mimeType: "image/png" },
    ] }] };
    const result = stripDeepSeekDocumentContext(context);
    expect(JSON.stringify(result)).not.toContain(document.id);
    expect(JSON.stringify(result)).not.toContain(document.authScope);
    expect(JSON.stringify(result)).toContain(document.name.replace(/"/g, '\\"'));
    expect(result.messages[0]).toMatchObject({ content: [{ type: "text" }, { type: "image", data: "image" }] });
    expect(JSON.stringify(context)).toContain(document.id);
  });

  it("rejects request-wide document limits, including references in earlier turns", () => {
    expect(() => prepareDeepSeekDocumentPayload({ messages: Array.from({ length: 21 }, () => ({ role: "user", content: marker })) }, model)).toThrow("20 个文档");
  });

  it("does not reinterpret tool output as document references", () => {
    const payload = { messages: [{ role: "tool", content: marker, tool_call_id: "x" }] };
    expect(prepareDeepSeekDocumentPayload(payload, model)).toEqual(payload);
  });

  it("removes malformed document metadata instead of forwarding it as a real file", () => {
    const result = prepareDeepSeekDocumentPayload({ messages: [{ role: "user", content: marker.replace(document.authScope, "invalid") }] }, model);
    expect(JSON.stringify(result)).not.toContain(document.id);
    expect(JSON.stringify(result)).toContain("无法读取");
  });

  it("retains a remote document when editing the question but respects removing its @name token", () => {
    const chipName = /^<file name="([^"]*)"/.exec(marker)![1];
    expect(restoreEditedDeepSeekDocuments(`原问题\n${marker}`, `修改后的问题 @${chipName}`)).toBe(`修改后的问题 ${marker}`);
    expect(restoreEditedDeepSeekDocuments(marker, "修改后的问题")).toBe("修改后的问题");
  });
});
