/** Verify official voice contracts, live-model gates, cancellation and bounded audio. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepSeekVoiceService, validateAsrWav, type DeepSeekVoiceDeps } from "./deepseek-voice";
import { encodePcmWav } from "../../src/lib/pcm-recording";

/** Supply only the live session surface used by voice requests. */
function fixture() {
  const model = { id: "deepseek-flash", api: "openai-completions", provider: "my-deepseek", baseUrl: "https://api.deepseek.com/v1" };
  const getAuth = vi.fn(async () => ({ auth: { apiKey: "test-voice-key" } }));
  const session = { model, modelRuntime: { getAuth } };
  let active: typeof session | null = session;
  const post = vi.fn<NonNullable<DeepSeekVoiceDeps["post"]>>();
  const service = new DeepSeekVoiceService({ getSession: () => active as never, post });
  return { model, session, getAuth, post, service, replace: (value: typeof session | null) => { active = value; } };
}

/** Produce a real one-second PCM WAV for payload and container tests. */
function wav(): Buffer {
  return Buffer.from(encodePcmWav(new Float32Array(16_000)));
}

afterEach(() => vi.useRealTimers());

describe("DeepSeek voice session gates", () => {
  it.each([
    { id: "deepseek-chat" },
    { id: "deepseek-flash-preview" },
    { api: "google-generative-ai" },
    { baseUrl: "https://api.deepseek.com.evil.example/v1" },
    { baseUrl: "http://api.deepseek.com/v1" },
  ])("never obtains credentials or sends voice for unsupported live models: %j", async (patch) => {
    const f = fixture();
    Object.assign(f.model, patch);
    const result = await f.service.speak({ requestId: "request-1", text: "回答" });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("当前模型") });
    expect(f.getAuth).not.toHaveBeenCalled();
    expect(f.post).not.toHaveBeenCalled();
  });

  it("rejects absent sessions and malformed cancellation identifiers", async () => {
    const f = fixture();
    f.replace(null);
    expect(await f.service.speak({ requestId: "request-1", text: "回答" })).toMatchObject({ ok: false });
    expect(f.service.cancel("../request")).toEqual({ ok: false });
    expect(f.service.cancel("unknown")).toEqual({ ok: true });
  });

  it("rechecks the session after asynchronous credential resolution", async () => {
    const f = fixture();
    let release!: (value: { auth: { apiKey: string } }) => void;
    f.getAuth.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const pending = f.service.speak({ requestId: "request-1", text: "回答" });
    f.replace({ ...f.session });
    release({ auth: { apiKey: "test-voice-key" } });
    expect(await pending).toMatchObject({ ok: false, error: "语音请求已取消" });
    expect(f.post).not.toHaveBeenCalled();
  });

  it("refuses credential URL overrides outside the official API", async () => {
    const f = fixture();
    f.getAuth.mockResolvedValueOnce({ auth: { apiKey: "key", baseUrl: "https://proxy.example/v1" } } as never);
    expect(await f.service.speak({ requestId: "request-1", text: "回答" })).toMatchObject({ ok: false, error: expect.stringContaining("官方") });
    expect(f.post).not.toHaveBeenCalled();
  });

  it("cancels transport and discards stale responses after a model switch", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.post.mockImplementationOnce(async (_path, _key, _body, _type, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("secret request URL")), { once: true });
    }));
    const pending = f.service.speak({ requestId: "request-1", text: "回答" });
    await Promise.resolve();
    f.session.model = { ...f.model, id: "other-model" };
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toEqual({ ok: false, error: "语音请求失败或已取消，请稍后重试" });
    expect(f.post.mock.calls[0][4].aborted).toBe(true);
  });

  it("honors explicit cancellation even when transport ignores the signal", async () => {
    const f = fixture();
    let release!: (value: Awaited<ReturnType<NonNullable<DeepSeekVoiceDeps["post"]>>>) => void;
    f.post.mockImplementationOnce(async () => new Promise((resolve) => { release = resolve; }));
    const pending = f.service.speak({ requestId: "request-1", text: "回答" });
    await Promise.resolve();
    f.service.cancel("request-1");
    release({ ok: true, status: 200, contentType: "audio/wav", body: wav() });
    expect(await pending).toEqual({ ok: false, error: "语音请求已取消" });
  });
});

describe("DeepSeek voice wire contracts", () => {
  it("uploads actual WAV bytes as multipart file and maps the ASR response", async () => {
    const f = fixture();
    f.post.mockResolvedValueOnce({ ok: true, status: 200, contentType: "application/json", body: Buffer.from('{"request_id":"upstream","text":"生成场景","duration_ms":1000}') });
    expect(await f.service.transcribe({ requestId: "request-1", audio: wav() }))
      .toEqual({ ok: true, text: "生成场景", durationMs: 1000 });
    const [path, key, payload, contentType] = f.post.mock.calls[0];
    expect(path).toBe("asr");
    expect(key).toBe("test-voice-key");
    expect(contentType).toMatch(/^multipart\/form-data; boundary=xagent-/);
    expect(payload.toString("utf8")).toContain('name="file"; filename="recording.wav"');
    expect(payload.includes(wav())).toBe(true);
    expect(payload.toString("utf8")).not.toContain('name="model"');
  });

  it("sends the documented TTS schema and returns only safe WAV bytes", async () => {
    const f = fixture();
    f.post.mockResolvedValueOnce({ ok: true, status: 200, contentType: "audio/wav", body: wav() });
    const result = await f.service.speak({ requestId: "request-1", text: "# 角色移动", voice: "tide" });
    expect(result).toEqual({ ok: true, mimeType: "audio/wav", audio: new Uint8Array(wav()) });
    const [path, , payload, contentType] = f.post.mock.calls[0];
    expect(path).toBe("tts");
    expect(contentType).toBe("application/json");
    expect(JSON.parse(payload.toString("utf8"))).toEqual({ text: "# 角色移动", voice_id: "tide", format: "wav", filter_markdown: true });
  });

  it.each(["", " ", "字".repeat(10_001)])("rejects empty or oversized TTS text before obtaining credentials", async (text) => {
    const f = fixture();
    expect(await f.service.speak({ requestId: "request-1", text })).toMatchObject({ ok: false });
    expect(f.getAuth).not.toHaveBeenCalled();
  });

  it("rejects malformed ASR JSON, unsafe audio and HTTP errors without leaking bodies", async () => {
    const f = fixture();
    f.post.mockResolvedValueOnce({ ok: true, status: 200, contentType: "application/json", body: Buffer.from('{"text":"hello","duration_ms":-1}') });
    expect(await f.service.transcribe({ requestId: "request-1", audio: wav() })).toEqual({ ok: false, error: "语音识别返回了无效结果" });
    f.post.mockResolvedValueOnce({ ok: true, status: 200, contentType: "text/html", body: Buffer.from("secret token") });
    expect(await f.service.speak({ requestId: "request-2", text: "回答" })).toEqual({ ok: false, error: "语音合成返回了无效音频" });
    f.post.mockResolvedValueOnce({ ok: false, status: 429, contentType: "application/json", body: Buffer.from("secret token") });
    expect(await f.service.speak({ requestId: "request-3", text: "回答" })).toEqual({ ok: false, error: "语音合成失败（HTTP 429）" });
  });
});

describe("actual WAV validation", () => {
  it("accepts renderer PCM and refuses renamed WebM, truncation and unsupported sample rates", () => {
    expect(validateAsrWav(wav())).toEqual(wav());
    expect(() => validateAsrWav(Buffer.alloc(44))).toThrow(/WAV/);
    expect(() => validateAsrWav(wav().subarray(0, 100))).toThrow(/不完整/);
    const invalid = wav(); invalid.writeUInt32LE(96_000, 24);
    expect(() => validateAsrWav(invalid)).toThrow(/16-bit/);
  });

  it("rejects over-duration and oversized recordings without trusting renderer metadata", () => {
    expect(() => validateAsrWav(encodePcmWav(new Float32Array(16_000 * 121)))).toThrow(/120/);
    expect(() => validateAsrWav(new Uint8Array(8 * 1024 * 1024 + 1))).toThrow(/8 MiB/);
  });
});
