/** Upload explicitly selected documents when sending, and reuse successful parses if a prompt must be retried. */
import type { ModelInfo } from "@shared/ipc";
import { encodeDeepSeekDocument, type DeepSeekDocument } from "@shared/deepseek-documents";
import type { FileReference } from "./file-attachment";

const uploaded = new WeakMap<File, Map<string, DeepSeekDocument>>();

/** Read browser-owned bytes without granting the renderer any filesystem privileges. */
function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? "").split(",", 2)[1] ?? "");
    reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`));
    reader.readAsDataURL(file);
  });
}

/** Return local references plus persisted remote chips; never upload a file after switching to another model. */
export async function prepareDeepSeekAttachments(refs: FileReference[], model?: ModelInfo | null, scope?: { sessionId?: string | null; isCurrent(): boolean }): Promise<{ local: FileReference[]; blocks: string[] }> {
  const remote = refs.filter((ref) => ref.deepseekFile);
  if (!remote.length) return { local: refs, blocks: [] };
  if (!model?.deepseekChatbot) throw new Error("这些文档已选择 DeepSeek 解析，请切回官方 deepseek-flash 后发送，或移除后重新添加。");
  if (remote.length > 20) throw new Error("每条消息最多添加 20 个 DeepSeek 文档。");
  const blocks: string[] = [];
  for (const ref of remote) {
    const file = ref.deepseekFile!;
    const purpose = ref.deepseekPurpose ?? "rich_layout_recognition";
    const key = `${model.provider}:${purpose}`;
    const cache = uploaded.get(file) ?? new Map<string, DeepSeekDocument>();
    const cachedDocument = cache.get(key);
    const limit = (purpose === "user_data" ? 32 : 100) * 1024 * 1024;
    if (file.size <= 0 || file.size > limit) throw new Error(`文件为空或超过 ${limit / 1024 / 1024} MiB：${file.name}`);
    if (scope && !scope.isCurrent()) throw new Error("会话或模型已切换，已取消附件发送。");
    const data = await readFileBase64(file);
    if (scope && !scope.isCurrent()) throw new Error("会话或模型已切换，已取消附件发送。");
    const result = await window.xAgent.files.deepseekUpload({ name: file.name, purpose, data, cachedDocument,
      ...(scope?.sessionId ? { expectedSessionId: scope.sessionId } : {}),
    });
    if (scope && !scope.isCurrent()) throw new Error("会话或模型已切换，已取消附件发送。");
    if (!result.ok) throw new Error(result.error);
    if (result.document.provider !== model.provider) throw new Error("供应商已切换，请重新发送文档。");
    const document = result.document;
    cache.set(key, document);
    uploaded.set(file, cache);
    blocks.push(encodeDeepSeekDocument(document));
  }
  return { local: refs.filter((ref) => !ref.deepseekFile), blocks };
}
