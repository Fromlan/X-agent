/** Send bounded binary voice requests through public DNS checks without redirects. */
import { request } from "node:https";
import { validateExternalHttpUrl } from "./external-url";
import { createPublicLookup } from "./public-http";

export interface VoiceHttpResponse {
  ok: boolean;
  status: number;
  contentType: string;
  body: Buffer;
}

/** Keep credentials on the fixed official HTTPS endpoint and reject incomplete audio. */
export function deepseekVoicePost(
  path: "asr" | "tts",
  apiKey: string,
  payload: Buffer,
  contentType: string,
  signal: AbortSignal,
): Promise<VoiceHttpResponse> {
  const checked = validateExternalHttpUrl(`https://api.deepseek.com/v1/tools/${path}`);
  if (!checked.ok) return Promise.reject(new Error(checked.error));
  const maximum = path === "asr" ? 1024 * 1024 : 64 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const req = request(checked.href, {
      method: "POST",
      agent: false,
      lookup: createPublicLookup(),
      signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": contentType,
        "Content-Length": String(payload.byteLength),
        Accept: path === "asr" ? "application/json" : "audio/wav",
      },
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.destroy();
        reject(new Error("语音接口不允许重定向"));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maximum) {
          res.destroy(new Error("语音接口响应过大"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("aborted", () => reject(new Error("语音接口响应中断")));
      res.on("end", () => {
        if (!res.complete) { reject(new Error("语音接口响应不完整")); return; }
        resolve({
          ok: status >= 200 && status < 300,
          status,
          contentType: String(res.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase(),
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on("error", reject);
    req.end(payload);
  });
}
