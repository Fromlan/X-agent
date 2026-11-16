/** Gate ASR and TTS against the live session and keep voice credentials in main. */
import { randomUUID } from "node:crypto";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { supportsDeepSeekChatbot } from "../../shared/deepseek-capabilities";
import {
  DEEPSEEK_ASR_MAX_BYTES,
  DEEPSEEK_ASR_MAX_SECONDS,
  DEEPSEEK_TTS_MAX_CHARACTERS,
  type DeepSeekTranscribeInput,
  type DeepSeekTranscribeResult,
  type DeepSeekSpeakInput,
  type DeepSeekSpeakResult,
} from "../../shared/deepseek-voice";
import { deepseekVoicePost } from "./deepseek-voice-http";

type VoiceSession = Pick<AgentSession, "model" | "modelRuntime">;
export interface DeepSeekVoiceDeps {
  getSession(): VoiceSession | null;
  post?: typeof deepseekVoicePost;
}

/** Validate the real WAV container, PCM format, byte rate and recording duration. */
export function validateAsrWav(audio: unknown): Buffer {
  if (!(audio instanceof Uint8Array) || audio.byteLength < 44 || audio.byteLength > DEEPSEEK_ASR_MAX_BYTES) {
    throw new Error("录音必须为不超过 8 MiB 的 PCM WAV 文件");
  }
  const wav = Buffer.from(audio);
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE" || wav.readUInt32LE(4) + 8 !== wav.length) {
    throw new Error("录音 WAV 文件不完整");
  }
  let byteRate = 0;
  let dataSize = 0;
  let formatValid = false;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (size > wav.length - start) throw new Error("录音 WAV 文件不完整");
    const tag = wav.toString("ascii", offset, offset + 4);
    if (tag === "fmt " && size >= 16) {
      const channels = wav.readUInt16LE(start + 2);
      const rate = wav.readUInt32LE(start + 4);
      byteRate = wav.readUInt32LE(start + 8);
      const alignment = wav.readUInt16LE(start + 12);
      formatValid = wav.readUInt16LE(start) === 1 && wav.readUInt16LE(start + 14) === 16 &&
        (channels === 1 || channels === 2) && [8000, 16000, 22050, 24000, 32000, 44100, 48000].includes(rate) &&
        alignment === channels * 2 && byteRate === rate * alignment;
    }
    if (tag === "data") dataSize += size;
    offset = start + size + (size % 2);
  }
  if (!formatValid || dataSize <= 0 || dataSize % 2 !== 0 || dataSize / byteRate > DEEPSEEK_ASR_MAX_SECONDS) {
    throw new Error("录音须为 16-bit PCM WAV，时长不超过 120 秒");
  }
  return wav;
}

/** Keep request identifiers bounded before using them as cancellation keys. */
function validRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}

/** Create the official multipart upload without accepting a renderer-provided filename. */
function asrMultipart(audio: Buffer): { body: Buffer; contentType: string } {
  const boundary = `xagent-${randomUUID()}`;
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="recording.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
      audio,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

/** Own cancellation and stale-session guards for independent voice operations. */
export class DeepSeekVoiceService {
  private readonly pending = new Map<string, AbortController>();
  private readonly post: typeof deepseekVoicePost;

  /** Bind the live session reader; tests may supply a deterministic transport. */
  constructor(private readonly deps: DeepSeekVoiceDeps) {
    this.post = deps.post ?? deepseekVoicePost;
  }

  /** Abort only a known request; cancellation never starts a model request. */
  cancel(requestId: string): { ok: boolean } {
    if (!validRequestId(requestId)) return { ok: false };
    this.pending.get(requestId)?.abort();
    return { ok: true };
  }

  /** Resolve auth from the current runtime and recheck the exact session before I/O. */
  private async run<T>(requestId: string, task: (key: string, signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!validRequestId(requestId)) throw new Error("无效的语音请求标识");
    const session = this.deps.getSession();
    const model = session?.model;
    if (!session || !model || !supportsDeepSeekChatbot(model)) {
      throw new Error("当前模型不支持 DeepSeek 语音功能");
    }
    if (this.pending.has(requestId) || this.pending.size >= 2) throw new Error("请先结束当前语音请求");
    const controller = new AbortController();
    this.pending.set(requestId, controller);
    /** Require the same live model object so switches cannot reuse the previous credential. */
    const isCurrent = (): boolean => this.deps.getSession() === session && session.model === model && supportsDeepSeekChatbot(session.model);
    const timer = setInterval(() => { if (!isCurrent()) controller.abort(); }, 100);
    try {
      const auth = await session.modelRuntime.getAuth(model, { signal: controller.signal });
      if (controller.signal.aborted || !isCurrent()) throw new Error("语音请求已取消");
      if (auth?.auth.baseUrl && !supportsDeepSeekChatbot({ ...model, baseUrl: auth.auth.baseUrl })) {
        throw new Error("当前凭据未指向 DeepSeek 官方接口");
      }
      const key = auth?.auth.apiKey;
      if (!key || /[\r\n]/.test(key)) throw new Error("当前模型未配置可用的 API Key");
      const result = await task(key, controller.signal);
      if (controller.signal.aborted || !isCurrent()) throw new Error("语音请求已取消");
      return result;
    } finally {
      clearInterval(timer);
      this.pending.delete(requestId);
    }
  }

  /** Transcribe bounded real PCM audio into an editable draft without sending a chat turn. */
  async transcribe(input: DeepSeekTranscribeInput): Promise<DeepSeekTranscribeResult> {
    try {
      const audio = validateAsrWav(input?.audio);
      return await this.run(input?.requestId, async (key, signal) => {
        const multipart = asrMultipart(audio);
        const result = await this.post("asr", key, multipart.body, multipart.contentType, signal);
        if (!result.ok) throw new Error(`语音识别失败（HTTP ${result.status}）`);
        let parsed: { text?: unknown; duration_ms?: unknown };
        try { parsed = JSON.parse(result.body.toString("utf8")); }
        catch { throw new Error("语音识别返回了无效结果"); }
        if (typeof parsed.text !== "string" || parsed.text.length > 100_000 ||
          typeof parsed.duration_ms !== "number" || !Number.isFinite(parsed.duration_ms) || parsed.duration_ms < 0 || parsed.duration_ms > 120_000) {
          throw new Error("语音识别返回了无效结果");
        }
        return { ok: true, text: parsed.text, durationMs: parsed.duration_ms };
      });
    } catch (error) {
      return { ok: false, error: this.failure(error) };
    }
  }

  /** Synthesize official WAV audio and return only bytes; renderer owns local playback. */
  async speak(input: DeepSeekSpeakInput): Promise<DeepSeekSpeakResult> {
    try {
      if (typeof input?.text !== "string" || !input.text.trim() || Array.from(input.text).length > DEEPSEEK_TTS_MAX_CHARACTERS) {
        throw new Error("朗读内容须为 1 至 10000 个字符");
      }
      if (input.voice !== undefined && input.voice !== "stella" && input.voice !== "tide") throw new Error("无效的朗读音色");
      const payload = Buffer.from(JSON.stringify({ text: input.text, voice_id: input.voice ?? "stella", format: "wav", filter_markdown: true }));
      if (payload.length > 64 * 1024) throw new Error("朗读请求超过 64 KiB");
      return await this.run(input.requestId, async (key, signal) => {
        const result = await this.post("tts", key, payload, "application/json", signal);
        if (!result.ok) throw new Error(`语音合成失败（HTTP ${result.status}）`);
        if (!["audio/wav", "audio/x-wav"].includes(result.contentType) || result.body.length < 44 ||
          result.body.toString("ascii", 0, 4) !== "RIFF" || result.body.toString("ascii", 8, 12) !== "WAVE") {
          throw new Error("语音合成返回了无效音频");
        }
        return { ok: true, audio: new Uint8Array(result.body), mimeType: "audio/wav" };
      });
    } catch (error) {
      return { ok: false, error: this.failure(error) };
    }
  }

  /** Never relay raw network or authentication exceptions that may contain secrets. */
  private failure(error: unknown): string {
    const message = error instanceof Error ? error.message : "";
    if (/^(录音|无效|当前|请先|语音|朗读)/.test(message)) return message;
    return "语音请求失败或已取消，请稍后重试";
  }
}
