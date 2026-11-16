/** Exercise binary transport bounds, complete responses and connection-time DNS guards. */
import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:https", () => ({ request: transport.request }));
import { deepseekVoicePost } from "./deepseek-voice-http";

beforeEach(() => vi.clearAllMocks());

/** Build a response that exposes the same completion flag as IncomingMessage. */
function response(statusCode = 200, complete = true) {
  const res = Object.assign(new EventEmitter(), {
    statusCode, complete, headers: { "content-type": "audio/wav; charset=binary" },
    destroy: vi.fn((error?: Error) => { if (error) res.emit("error", error); }),
  });
  return res;
}

it("posts binary bytes only to official HTTPS with pinned DNS and bearer auth", async () => {
  const payload = Buffer.from([0, 1, 254, 255]);
  transport.request.mockImplementation((url, options, callback) => {
    expect(url).toBe("https://api.deepseek.com/v1/tools/tts");
    expect(options).toMatchObject({ method: "POST", agent: false, headers: {
      Authorization: "Bearer test-key", "Content-Type": "application/json", "Content-Length": "4", Accept: "audio/wav",
    } });
    expect(typeof options.lookup).toBe("function");
    return Object.assign(new EventEmitter(), { end: (body: Buffer) => {
      expect(body).toEqual(payload);
      const res = response();
      callback(res);
      res.emit("data", payload);
      res.emit("end");
    } });
  });
  expect(await deepseekVoicePost("tts", "test-key", payload, "application/json", new AbortController().signal))
    .toEqual({ ok: true, status: 200, contentType: "audio/wav", body: payload });
});

it("refuses redirects without forwarding credentials", async () => {
  const res = response(307);
  transport.request.mockImplementation((_url, _options, callback) => Object.assign(new EventEmitter(), { end: () => callback(res) }));
  await expect(deepseekVoicePost("asr", "key", Buffer.alloc(0), "multipart/form-data", new AbortController().signal)).rejects.toThrow("重定向");
  expect(transport.request).toHaveBeenCalledOnce();
  expect(res.destroy).toHaveBeenCalled();
});

it.each(["incomplete", "aborted", "oversized"])("rejects %s responses instead of delivering damaged audio", async (mode) => {
  transport.request.mockImplementation((_url, _options, callback) => Object.assign(new EventEmitter(), { end: () => {
    const res = response(200, mode !== "incomplete");
    callback(res);
    if (mode === "aborted") res.emit("aborted");
    else if (mode === "oversized") res.emit("data", Buffer.alloc(1024 * 1024 + 1));
    else res.emit("end");
  } }));
  await expect(deepseekVoicePost("asr", "key", Buffer.alloc(0), "multipart/form-data", new AbortController().signal)).rejects.toThrow();
});

it("forwards caller cancellation to the request signal", async () => {
  const abort = new AbortController();
  transport.request.mockImplementation((_url, options) => {
    const req = Object.assign(new EventEmitter(), { end: vi.fn() });
    options.signal.addEventListener("abort", () => req.emit("error", options.signal.reason), { once: true });
    return req;
  });
  const pending = deepseekVoicePost("tts", "key", Buffer.alloc(0), "application/json", abort.signal);
  abort.abort();
  await expect(pending).rejects.toThrow();
});
