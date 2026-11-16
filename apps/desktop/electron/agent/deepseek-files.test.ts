/** Verify file uploads preserve protocol ordering and cannot outlive their credential owner. */
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import type { SessionHost } from "./session-host";
import { uploadDeepSeekFile, type DeepSeekFileUploadInput } from "./deepseek-files";

const FIXTURE_SCOPE = createHash("sha256").update("x-agent-deepseek-files\0fixture-secret").digest("hex");

const mocks = vi.hoisted(() => ({ request: vi.fn(), validate: vi.fn(), lookup: vi.fn() }));
vi.mock("node:https", () => ({ request: mocks.request }));
vi.mock("./external-url", () => ({ validateOutboundHttpUrl: mocks.validate }));
vi.mock("./public-http", () => ({ createPublicLookup: () => mocks.lookup }));

/** Construct the small session shape consumed by this independent main-process operation. */
function fixture() {
  const model = { id: "deepseek-flash", provider: "custom-deepseek", api: "openai-completions", baseUrl: "https://api.deepseek.com/v1" };
  const getAuth = vi.fn().mockResolvedValue({ auth: { apiKey: "fixture-secret" } });
  const session = { sessionId: "session-a", model, modelRuntime: { getAuth } };
  const host = { getBundle: () => ({ session }) } as unknown as Pick<SessionHost, "getBundle">;
  const input: DeepSeekFileUploadInput = { name: "报告.pdf", data: Buffer.from("%PDF fixture").toString("base64"), purpose: "rich_layout_recognition" };
  return { model, getAuth, session, host, input };
}

/** Simulate a complete Node response while preserving the outbound socket options for assertions. */
function reply(body = '{"id":"file-api-fixture"}', status = 200, complete = true) {
  mocks.request.mockImplementation((_url, _options, callback) => {
    const res = Object.assign(new EventEmitter(), { statusCode: status, complete,
      destroy: (error?: Error) => { if (error) res.emit("error", error); } });
    return Object.assign(new EventEmitter(), { end: () => {
      callback(res);
      res.emit("data", Buffer.from(body));
      res.emit("end");
    } });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.validate.mockResolvedValue({ ok: true, href: "https://api.deepseek.com/files" });
  reply();
});

it("uploads purpose before file with the active key and a connection-time DNS lookup", async () => {
  const { host, input, getAuth, model } = fixture();
  let payload: Buffer | undefined;
  mocks.request.mockImplementation((url, options, callback) => {
    expect(url).toBe("https://api.deepseek.com/files");
    expect(options).toMatchObject({ method: "POST", agent: false, lookup: mocks.lookup,
      headers: { Authorization: "Bearer fixture-secret", Accept: "application/json" } });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    return Object.assign(new EventEmitter(), { end: (body: Buffer) => {
      payload = body;
      expect(options.headers["Content-Length"]).toBe(String(body.length));
      const res = Object.assign(new EventEmitter(), { statusCode: 200, complete: true });
      callback(res);
      res.emit("data", Buffer.from('{"id":"file-api-123"}'));
      res.emit("end");
    } });
  });
  await expect(uploadDeepSeekFile(host, input)).resolves.toEqual({ id: "file-api-123", name: "报告.pdf", provider: "custom-deepseek", purpose: "rich_layout_recognition", authScope: FIXTURE_SCOPE });
  const text = payload!.toString("utf8");
  expect(text.indexOf('name="purpose"')).toBeLessThan(text.indexOf('name="file"'));
  expect(text).toContain('filename="报告.pdf"');
  expect(text).toContain("%PDF fixture");
  expect(getAuth).toHaveBeenCalledWith(model, { signal: expect.any(AbortSignal) });
});

it("reuses a valid same-account cached reference without making a billable upload", async () => {
  const { host, input } = fixture();
  const cachedDocument = { id: "file-api-cached", name: input.name, provider: "custom-deepseek", purpose: input.purpose, authScope: FIXTURE_SCOPE };
  await expect(uploadDeepSeekFile(host, { ...input, cachedDocument })).resolves.toEqual(cachedDocument);
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.validate).not.toHaveBeenCalled();
});

it("rejects a delayed renderer upload belonging to the previous session before decoding or auth", async () => {
  const { host, input, getAuth } = fixture();
  await expect(uploadDeepSeekFile(host, { ...input, data: "invalid bytes", expectedSessionId: "previous-session" }))
    .rejects.toThrow("会话已切换，已取消附件上传。");
  expect(getAuth).not.toHaveBeenCalled();
  expect(mocks.validate).not.toHaveBeenCalled();
  expect(mocks.request).not.toHaveBeenCalled();
});

it("uploads the original bytes again after the same provider changes to another account", async () => {
  const { host, input, getAuth } = fixture();
  const cachedDocument = { id: "file-api-cached", name: input.name, provider: "custom-deepseek", purpose: input.purpose, authScope: FIXTURE_SCOPE };
  getAuth.mockResolvedValueOnce({ auth: { apiKey: "second-account-secret" } });
  const result = await uploadDeepSeekFile(host, { ...input, cachedDocument });
  expect(result.id).toBe("file-api-fixture");
  expect(result.authScope).toBe(createHash("sha256").update("x-agent-deepseek-files\0second-account-secret").digest("hex"));
  expect(result.authScope).not.toBe(FIXTURE_SCOPE);
  expect(mocks.request).toHaveBeenCalledOnce();
});

it.each([
  { id: "file-api-other", name: "other.pdf" }, { provider: "other-provider" }, { purpose: "text_recognition" }, { id: "file-api-cached\r\n" },
])("ignores a cache with mismatched or invalid attachment metadata: %j", async (change) => {
  const { host, input } = fixture();
  const cachedDocument = { id: "file-api-cached", name: input.name, provider: "custom-deepseek", purpose: input.purpose, authScope: FIXTURE_SCOPE, ...change };
  await expect(uploadDeepSeekFile(host, { ...input, cachedDocument } as DeepSeekFileUploadInput)).resolves.toMatchObject({ id: "file-api-fixture" });
  expect(mocks.request).toHaveBeenCalledOnce();
});

it.each([
  { id: "other-model" }, { id: "deepseek-v4-pro" }, { baseUrl: "https://proxy.example/v1" },
  { baseUrl: "https://api.deepseek.com.evil.example/v1" }, { api: "openai-responses" },
])("refuses unsupported targets before resolving credentials: %j", async (change) => {
  const { host, model, input, getAuth } = fixture();
  Object.assign(model, change);
  await expect(uploadDeepSeekFile(host, input)).rejects.toThrow("当前模型不支持");
  expect(getAuth).not.toHaveBeenCalled();
  expect(mocks.request).not.toHaveBeenCalled();
});

it("refuses credentials overriding the official host and hides auth exceptions", async () => {
  const { host, input, getAuth } = fixture();
  getAuth.mockResolvedValueOnce({ auth: { apiKey: "fixture-secret", baseUrl: "https://proxy.example" } });
  await expect(uploadDeepSeekFile(host, input)).rejects.toThrow("凭据未指向");
  getAuth.mockRejectedValueOnce(new Error("Authorization: fixture-secret"));
  await expect(uploadDeepSeekFile(host, input)).rejects.toThrow("文件上传失败或超时");
  expect(mocks.request).not.toHaveBeenCalled();
});

it.each([
  { name: "C:\\private\\a.pdf" }, { name: "../a.pdf" }, { name: 'a".pdf' }, { name: "a\r\n.pdf" },
  { name: "program.exe", purpose: "user_data" }, { purpose: "user_data" },
  { data: "data:application/pdf;base64,AAAA" }, { data: "AA=A" }, { data: "A===" }, { data: "" },
])("refuses unsafe names, unsupported purposes and invalid bytes: %j", async (change) => {
  const { host, input, getAuth } = fixture();
  await expect(uploadDeepSeekFile(host, { ...input, ...change } as DeepSeekFileUploadInput)).rejects.toThrow();
  expect(getAuth).not.toHaveBeenCalled();
  expect(mocks.request).not.toHaveBeenCalled();
});

it("enforces the 32 MiB user-data limit before decoding", async () => {
  const { host, input, getAuth } = fixture();
  await expect(uploadDeepSeekFile(host, { ...input, name: "large.txt", purpose: "user_data", data: "A".repeat(Math.ceil(32 * 1024 * 1024 / 3) * 4 + 4) })).rejects.toThrow("32 MiB");
  expect(getAuth).not.toHaveBeenCalled();
});

it("uploads valid 8 MiB Base64 without overflowing the JavaScript regexp stack", async () => {
  const { host, input } = fixture();
  const data = Buffer.alloc(8 * 1024 * 1024, 0x61).toString("base64");
  await expect(uploadDeepSeekFile(host, { ...input, name: "large.txt", purpose: "user_data", data }))
    .resolves.toMatchObject({ id: "file-api-fixture", authScope: FIXTURE_SCOPE });
  expect(mocks.request).toHaveBeenCalledOnce();
});

it("accepts an ordinary multi-MiB Base64 document without exhausting the regexp stack", async () => {
  const { host, input } = fixture();
  const data = "QUFB".repeat(2 * 1024 * 1024);
  await expect(uploadDeepSeekFile(host, { ...input, data })).resolves.toMatchObject({ id: "file-api-fixture" });
  expect(mocks.request).toHaveBeenCalledOnce();
});

it("accepts text files and rejects a public-DNS preflight failure", async () => {
  const { host, input } = fixture();
  await expect(uploadDeepSeekFile(host, { ...input, name: "scene.gd", purpose: "user_data" })).resolves.toMatchObject({ purpose: "user_data" });
  mocks.validate.mockResolvedValueOnce({ ok: false, error: "private address fixture-secret" });
  await expect(uploadDeepSeekFile(host, input)).rejects.toThrow("公网地址校验");
  expect(mocks.request).toHaveBeenCalledTimes(1);
});

it("does not upload after an awaited credential lookup switches the model", async () => {
  const { host, input, session, getAuth } = fixture();
  getAuth.mockImplementationOnce(async () => {
    session.model = { ...session.model, id: "other" };
    return { auth: { apiKey: "fixture-secret" } };
  });
  await expect(uploadDeepSeekFile(host, input)).rejects.toThrow("会话或模型已切换");
  expect(mocks.request).not.toHaveBeenCalled();
});

it("discards a successful upload if the owning session changed in flight", async () => {
  const { host, input } = fixture();
  const current = host.getBundle()!.session;
  mocks.request.mockImplementation((_url, _options, callback) => Object.assign(new EventEmitter(), { end: () => {
    vi.spyOn(host, "getBundle").mockReturnValue({ session: { ...current } } as ReturnType<SessionHost["getBundle"]>);
    const res = Object.assign(new EventEmitter(), { statusCode: 200, complete: true });
    callback(res);
    res.emit("data", Buffer.from('{"id":"file-api-fixture"}'));
    res.emit("end");
  } }));
  await expect(uploadDeepSeekFile(host, input)).rejects.toThrow("会话或模型已切换");
});

it.each([400, 401, 402, 408, 413, 429, 503, 504])("reports status %i without exposing raw server errors", async (status) => {
  const { host, input } = fixture();
  reply('{"error":{"message":"fixture-secret"}}', status);
  await expect(uploadDeepSeekFile(host, input)).rejects.toThrow(`HTTP ${status}`);
  await uploadDeepSeekFile(host, input).catch((error: Error) => expect(error.message).not.toContain("fixture-secret"));
});

it.each(["not JSON", '{"id":"https://evil.example/file"}', '{"id":"file-api-ok","error":"fixture-secret"}'])
  ("rejects invalid success responses: %s", async (body) => {
    const { host, input } = fixture();
    reply(body);
    await expect(uploadDeepSeekFile(host, input)).rejects.toThrow(/无效/);
  });

it("rejects redirects, incomplete responses and oversized JSON", async () => {
  const { host, input } = fixture();
  reply("", 307);
  await expect(uploadDeepSeekFile(host, input)).rejects.toThrow("不允许重定向");
  reply("{}", 200, false);
  await expect(uploadDeepSeekFile(host, input)).rejects.toThrow("响应不完整");
  reply(" ".repeat(1024 * 1024 + 1));
  await expect(uploadDeepSeekFile(host, input)).rejects.toThrow("1 MiB");
});

it("aborts an in-flight upload as soon as its session model changes", async () => {
  vi.useFakeTimers();
  try {
    const { host, input, model } = fixture();
    let connected!: () => void;
    const started = new Promise<void>((resolve) => { connected = resolve; });
    mocks.request.mockImplementation((_url, options) => {
      const req = Object.assign(new EventEmitter(), { end: () => connected() });
      options.signal.addEventListener("abort", () => req.emit("error", options.signal.reason), { once: true });
      return req;
    });
    const pending = uploadDeepSeekFile(host, input);
    const rejection = expect(pending).rejects.toThrow("会话或模型已切换");
    await started;
    model.id = "other";
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
  } finally { vi.useRealTimers(); }
});
