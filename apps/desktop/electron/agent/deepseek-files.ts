/** Upload explicit attachment bytes through the active official DeepSeek account without filesystem access. */
import { createHash, randomUUID } from "node:crypto";
import { request as httpsRequest } from "node:https";
import type { SessionHost } from "./session-host";
import { supportsDeepSeekChatbot } from "../../shared/deepseek-capabilities";
import type { DeepSeekDocument, DeepSeekFileUploadInput } from "../../shared/deepseek-documents";
import { validateOutboundHttpUrl } from "./external-url";
import { createPublicLookup } from "./public-http";

export type { DeepSeekFileUploadInput, DeepSeekFilePurpose } from "../../shared/deepseek-documents";
export type DeepSeekUploadedFile = DeepSeekDocument;

const MIB = 1024 * 1024;
const ENDPOINT = "https://api.deepseek.com/files";
const LAYOUT_EXTENSIONS = new Set(["pdf", "doc", "docx", "ppt", "pptx"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff"]);
const USER_DATA_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "txt", "md", "markdown", "csv", "tsv", "json", "jsonl",
  "xml", "yaml", "yml", "toml", "ini", "cfg", "log", "rst", "tex", "html", "htm", "css", "scss",
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "gd", "gdshader", "tscn", "tres", "godot",
  "cs", "cpp", "c", "h", "hpp", "java", "kt", "rs", "go", "rb", "php", "sql", "sh", "ps1",
  "xlsx", "xls", "epub", "mobi",
]);

/** Mark only locally authored errors safe for presentation; provider errors remain private. */
class FileUploadError extends Error {}

/** Accept cached IDs only when they belong to these exact bytes' filename, purpose and current credential scope. */
function reusableDocument(input: DeepSeekFileUploadInput, provider: string, authScope: string): DeepSeekUploadedFile | null {
  const cached = input.cachedDocument;
  if (!cached || typeof cached !== "object" || typeof cached.id !== "string" || !/^file-api-[A-Za-z0-9_-]{1,200}$/.test(cached.id) ||
      cached.name !== input.name || cached.provider !== provider || cached.purpose !== input.purpose || cached.authScope !== authScope) return null;
  return { id: cached.id, name: cached.name, provider, purpose: cached.purpose, authScope };
}

/** Validate names, purpose and encoded size before allocating the decoded attachment. */
function decodeAttachment(input: DeepSeekFileUploadInput): Buffer {
  if (!input || typeof input.name !== "string" || input.name.length < 1 || input.name.length > 255 ||
      /[\u0000-\u001f\u007f/\\:"<>|?*]/.test(input.name) || /[. ]$/.test(input.name)) {
    throw new FileUploadError("附件文件名无效，请重新选择文件。");
  }
  const extension = input.name.includes(".") ? input.name.slice(input.name.lastIndexOf(".") + 1).toLowerCase() : "";
  let maximum: number;
  if (input.purpose === "user_data") {
    if (!USER_DATA_EXTENSIONS.has(extension)) throw new FileUploadError("该附件格式不支持普通文件上传，请选择正确的解析方式。");
    maximum = 32 * MIB;
  } else if (input.purpose === "text_recognition" || input.purpose === "rich_layout_recognition") {
    if (!LAYOUT_EXTENSIONS.has(extension) && !IMAGE_EXTENSIONS.has(extension)) {
      throw new FileUploadError("文字或图文解析仅支持 PDF、Word、PowerPoint 和图片文件。");
    }
    maximum = (IMAGE_EXTENSIONS.has(extension) ? 64 : 100) * MIB;
  } else {
    throw new FileUploadError("附件解析方式无效。");
  }
  if (typeof input.data !== "string" || !input.data || input.data.length > Math.ceil(maximum / 3) * 4) {
    throw new FileUploadError(`附件为空或超过 ${maximum / MIB} MiB 上限。`);
  }
  const firstPadding = input.data.indexOf("=");
  const padding = input.data.endsWith("==") ? 2 : input.data.endsWith("=") ? 1 : 0;
  if (input.data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(input.data) ||
      (firstPadding !== -1 && firstPadding !== input.data.length - padding)) {
    throw new FileUploadError("附件内容不是有效的 Base64 数据。");
  }
  const bytes = Buffer.from(input.data, "base64");
  if (!bytes.length || bytes.length > maximum) throw new FileUploadError(`附件为空或超过 ${maximum / MIB} MiB 上限。`);
  return bytes;
}

/** Keep the required purpose field before file while retaining the user's Unicode filename. */
function createMultipart(input: DeepSeekFileUploadInput, bytes: Buffer): { body: Buffer; contentType: string } {
  const boundary = `xagent-file-${randomUUID()}`;
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\n${input.purpose}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${input.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

/** Pin socket DNS, refuse redirects and reject oversized or incomplete JSON responses. */
function postFile(key: string, body: Buffer, contentType: string, signal: AbortSignal): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(ENDPOINT, {
      method: "POST", agent: false, lookup: createPublicLookup(),
      signal: AbortSignal.any([signal, AbortSignal.timeout(250_000)]),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": contentType, "Content-Length": String(body.length), Accept: "application/json" },
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) { res.destroy(); reject(new FileUploadError("DeepSeek 文件接口不允许重定向。")); return; }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > MIB) { res.destroy(new FileUploadError("DeepSeek 文件响应超过 1 MiB。")); return; }
        chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("aborted", () => reject(new FileUploadError("DeepSeek 文件响应中断，请重新上传。")));
      res.on("end", () => {
        if (!res.complete) { reject(new FileUploadError("DeepSeek 文件响应不完整，请重新上传。")); return; }
        resolve({ status, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

/** Upload only for the current eligible model and discard results when its owning session changes. */
export async function uploadDeepSeekFile(host: Pick<SessionHost, "getBundle">, input: DeepSeekFileUploadInput): Promise<DeepSeekUploadedFile> {
  const session = host.getBundle()?.session;
  if (input?.expectedSessionId !== undefined && input.expectedSessionId !== session?.sessionId) {
    throw new Error("会话已切换，已取消附件上传。");
  }
  const model = session?.model;
  if (!session || !model || !supportsDeepSeekChatbot(model)) throw new Error("当前模型不支持 DeepSeek 文件解析。");
  const bytes = decodeAttachment(input);
  const runtime = session.modelRuntime;
  const sessionId = session.sessionId;
  const identity = [model.provider, model.id, model.api, model.baseUrl].join("\n");
  const controller = new AbortController();
  /** Compare sessions rather than host bundles because the facade returns fresh bundle objects. */
  const isCurrent = (): boolean => host.getBundle()?.session === session && session.sessionId === sessionId &&
    session.modelRuntime === runtime && session.model === model && supportsDeepSeekChatbot(model) &&
    [model.provider, model.id, model.api, model.baseUrl].join("\n") === identity;
  const timer = setInterval(() => { if (!isCurrent()) controller.abort(); }, 100);
  try {
    const auth = await runtime.getAuth(model, { signal: controller.signal });
    if (!isCurrent() || controller.signal.aborted) throw new FileUploadError("会话或模型已切换，请重新上传附件。");
    if (auth?.auth.baseUrl && !supportsDeepSeekChatbot({ ...model, baseUrl: auth.auth.baseUrl })) {
      throw new FileUploadError("当前凭据未指向 DeepSeek 官方接口。");
    }
    const key = auth?.auth.apiKey;
    if (typeof key !== "string" || !key.trim() || /[\r\n]/.test(key)) throw new FileUploadError("当前模型未配置可用的 API Key。");
    const authScope = createHash("sha256").update(`x-agent-deepseek-files\0${key}`).digest("hex");
    const cached = reusableDocument(input, model.provider, authScope);
    if (cached) return cached;
    const target = await validateOutboundHttpUrl(ENDPOINT);
    if (!target.ok) throw new FileUploadError("DeepSeek 文件接口无法通过公网地址校验。");
    if (!isCurrent() || controller.signal.aborted) throw new FileUploadError("会话或模型已切换，请重新上传附件。");
    const multipart = createMultipart(input, bytes);
    const response = await postFile(key, multipart.body, multipart.contentType, controller.signal);
    if (!isCurrent() || controller.signal.aborted) throw new FileUploadError("会话或模型已切换，请重新上传附件。");
    if (response.status < 200 || response.status >= 300) {
      const details: Record<number, string> = {
        400: "文件格式或解析内容不受支持", 401: "API Key 无效", 402: "账户余额不足", 403: "文件上传被拒绝",
        408: "上传超时", 413: "文件过大", 429: "调用频率或存储配额超限", 503: "服务繁忙", 504: "解析超时",
      };
      throw new FileUploadError(`DeepSeek 文件上传失败（HTTP ${response.status}）：${details[response.status] ?? "服务暂不可用"}。`);
    }
    let result: unknown;
    try { result = JSON.parse(response.body); } catch { throw new FileUploadError("DeepSeek 文件接口返回了无效 JSON。"); }
    if (!result || typeof result !== "object" || Array.isArray(result) || !("id" in result) ||
        typeof result.id !== "string" || !/^file-api-[A-Za-z0-9_-]{1,200}$/.test(result.id) || "error" in result) {
      throw new FileUploadError("DeepSeek 文件接口返回了无效文件标识。");
    }
    return { id: result.id, name: input.name, provider: model.provider, purpose: input.purpose, authScope };
  } catch (error) {
    if (!isCurrent() || controller.signal.aborted) throw new Error("会话或模型已切换，请重新上传附件。");
    throw new Error(error instanceof FileUploadError ? error.message : "DeepSeek 文件上传失败或超时，请检查网络后重试。");
  } finally {
    clearInterval(timer);
  }
}
