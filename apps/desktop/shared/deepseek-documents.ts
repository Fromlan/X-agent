/** Preserve uploaded document references in Pi's text-only user history and scope replay to their provider. */
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { supportsDeepSeekChatbot, type DeepSeekModelTarget } from "./deepseek-capabilities";

export type DeepSeekFilePurpose = "text_recognition" | "rich_layout_recognition" | "user_data";

export interface DeepSeekDocument {
  id: string;
  name: string;
  provider: string;
  purpose: DeepSeekFilePurpose;
  /** One-way credential scope; file identifiers are never replayed to a different API account. */
  authScope: string;
}

export interface DeepSeekFileUploadInput {
  name: string;
  data: string;
  purpose: DeepSeekFilePurpose;
  cachedDocument?: DeepSeekDocument;
  expectedSessionId?: string;
}

export type DeepSeekFileUploadResult = { ok: true; document: DeepSeekDocument } | { ok: false; error: string };

const DOCUMENT_BLOCK = /<file\s+name="[^"]*">\s*<deepseek_document>([\s\S]*?)<\/deepseek_document>\s*<\/file>/g;

/** Encode a bounded reference in the existing file-chip syntax, without persisting document bytes. */
export function encodeDeepSeekDocument(document: DeepSeekDocument): string {
  const name = document.name.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const metadata = JSON.stringify(document).replace(/</g, "\\u003c");
  return `<file name="${name}">\n<deepseek_document>${metadata}</deepseek_document>\n</file>`;
}

/** Parse only the metadata shape produced by the upload API so invalid references can be removed. */
function readDocument(raw: string): DeepSeekDocument | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || !/^file-[A-Za-z0-9_-]{1,240}$/.test(row.id) ||
      typeof row.name !== "string" || row.name.length > 512 || typeof row.provider !== "string" || row.provider.length > 256 ||
      typeof row.authScope !== "string" || !/^[a-f0-9]{64}$/.test(row.authScope) ||
      !["text_recognition", "rich_layout_recognition", "user_data"].includes(String(row.purpose))) return null;
    return { id: row.id, name: row.name, provider: row.provider, purpose: row.purpose as DeepSeekFilePurpose, authScope: row.authScope };
  } catch { return null; }
}

/** Replace persisted references with readable attachment names when a different model consumes the history. */
export function stripDeepSeekDocumentText(text: string): string {
  return text.replace(DOCUMENT_BLOCK, (_match, raw: string) => {
    const document = readDocument(raw);
    return document ? `[附件：${document.name}；该文档需使用原 DeepSeek 供应商重新读取]` : "[无法读取的 DeepSeek 附件]";
  });
}

/** Retain remote attachments explicitly left as @name tokens when the user edits a saved question. */
export function restoreEditedDeepSeekDocuments(original: string, draft: string): string {
  let restored = draft;
  for (const match of original.matchAll(DOCUMENT_BLOCK)) {
    const block = match[0];
    const name = /^<file\s+name="([^"]*)"/.exec(block)?.[1];
    if (name && readDocument(match[1])) restored = restored.replace(`@${name}`, () => block);
  }
  return restored;
}

/** Remove remote file identifiers before delegating a request to a non-DeepSeek adapter. */
export function stripDeepSeekDocumentContext(context: TranscriptContext): TranscriptContext {
  return {
    ...context,
    messages: context.messages.map((message) => message.role !== "user" ? message : {
      ...message,
      content: typeof message.content === "string" ? stripDeepSeekDocumentText(message.content)
        : message.content.map((part) => part.type === "text" ? { ...part, text: stripDeepSeekDocumentText(part.text) } : part),
    }),
  };
}

/** Convert persisted file chips into the selected official protocol's document blocks at the last request boundary. */
export function prepareDeepSeekDocumentPayload(payload: unknown, model: DeepSeekModelTarget & { provider: string }): unknown {
  if (!supportsDeepSeekChatbot(model) || !payload || typeof payload !== "object") return payload;
  const body = payload as Record<string, unknown>;
  if (!Array.isArray(body.messages)) return payload;
  let documentCount = 0;
  const messages = body.messages.map((message: unknown) => {
    if (!message || typeof message !== "object") return message;
    const row = message as Record<string, unknown>;
    if (row.role !== "user") return message;
    const initial = typeof row.content === "string" ? [{ type: "text", text: row.content }] : row.content;
    if (!Array.isArray(initial)) return message;
    let changed = false;
    const content: unknown[] = [];
    for (const part of initial) {
      if (!part || typeof part !== "object" || part.type !== "text" || typeof part.text !== "string") {
        content.push(part);
        continue;
      }
      const documents: DeepSeekDocument[] = [];
      const text = part.text.replace(DOCUMENT_BLOCK, (_match: string, raw: string) => {
        changed = true;
        const document = readDocument(raw);
        if (!document) return "[无法读取的 DeepSeek 附件]";
        if (document.provider !== model.provider) return `[附件：${document.name}；请在当前供应商重新上传]`;
        documents.push(document);
        return `[附件：${document.name}]`;
      });
      for (const document of documents) {
        documentCount++;
        content.push(model.api === "anthropic-messages"
          ? { type: "document", source: { type: "file", file_id: document.id }, x_agent_auth_scope: document.authScope }
          : { type: "file", file_id: document.id, x_agent_auth_scope: document.authScope });
      }
      if (text) content.push({ ...part, text });
    }
    return changed ? { ...row, content } : message;
  });
  if (documentCount > 20) throw new Error("DeepSeek 每次请求最多引用 20 个文档，请新建会话或压缩历史后重试。");
  return { ...body, messages };
}
