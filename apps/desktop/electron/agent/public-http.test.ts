/** Lock down redirect refusal, connection DNS pinning and bounded response handling. */
import { beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { LookupFunction } from "node:net";
const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:http", () => ({ request: transport.request }));
vi.mock("node:https", () => ({ request: transport.request }));
import { createPublicLookup, publicHttpGet, publicHttpPost } from "./public-http";

beforeEach(() => vi.clearAllMocks());

/** Invoke Node's lookup contract exactly as a socket would. */
function resolveSocket(fn: LookupFunction, all = false) {
  return new Promise((resolve, reject) => fn("provider.example", { all }, (err, address, family) => {
    if (err) reject(err); else resolve({ address, family });
  }));
}

it("pins the validated address returned by the connection lookup", async () => {
  const resolver = vi.fn().mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
    .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
  const lookup = createPublicLookup(resolver);
  await expect(resolveSocket(lookup)).resolves.toEqual({ address: "93.184.216.34", family: 4 });
  await expect(resolveSocket(lookup)).rejects.toThrow(/私有/);
  expect(resolver).toHaveBeenCalledTimes(2);
});

it("rejects mixed public/private answers, failed DNS and accepts all-public IPv6", async () => {
  await expect(resolveSocket(createPublicLookup(async () => [
    { address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 },
  ]))).rejects.toThrow(/私有/);
  await expect(resolveSocket(createPublicLookup(async () => { throw new Error("secret detail"); }))).rejects.toThrow("域名无法解析");
  await expect(resolveSocket(createPublicLookup(async () => [{ address: "2606:4700:4700::1111", family: 6 }]), true))
    .resolves.toEqual({ address: [{ address: "2606:4700:4700::1111", family: 6 }], family: undefined });
});

it.each(["http://127.0.0.1:8765/", "http://10.1.1.1/"])("refuses literal private targets without creating a connection: %s", async (url) => {
  await expect(publicHttpGet(url, {}, 100)).rejects.toThrow();
  expect(transport.request).not.toHaveBeenCalled();
});

it.each(["http://127.0.0.1/", "https://provider.example/loop"])("never follows a redirect to %s", async (location) => {
  const response = Object.assign(new EventEmitter(), { statusCode: 302, headers: { location }, destroy: vi.fn() });
  transport.request.mockImplementation((_url, options, callback) => {
    expect(options.agent).toBe(false);
    expect(typeof options.lookup).toBe("function");
    return Object.assign(new EventEmitter(), { end: () => callback(response) });
  });
  await expect(publicHttpGet("https://provider.example/models", { Authorization: "Bearer placeholder" }, 1000)).rejects.toThrow(/重定向/);
  expect(transport.request).toHaveBeenCalledTimes(1);
  expect(response.destroy).toHaveBeenCalled();
});

it("returns normal JSON and rejects responses larger than the byte budget", async () => {
  let oversized = false;
  transport.request.mockImplementation((_url, _options, callback) => {
    const response = Object.assign(new EventEmitter(), { statusCode: 200, destroy: (err: Error) => response.emit("error", err) });
    return Object.assign(new EventEmitter(), { end: () => {
      callback(response);
      response.emit("data", oversized ? Buffer.alloc(2 * 1024 * 1024 + 1) : Buffer.from('{"data":[]}'));
      response.emit("end");
    } });
  });
  await expect(publicHttpGet("https://provider.example/models", {}, 1000)).resolves.toEqual({ ok: true, status: 200, body: '{"data":[]}' });
  oversized = true;
  await expect(publicHttpGet("https://provider.example/models", {}, 1000)).rejects.toThrow(/2 MiB/);
});

it("POSTs UTF-8 JSON with a bounded cancellable request and pinned DNS", async () => {
  const controller = new AbortController();
  let combined: AbortSignal | undefined;
  transport.request.mockImplementation((_url, options, callback) => {
    expect(options.method).toBe("POST");
    expect(options.agent).toBe(false);
    expect(typeof options.lookup).toBe("function");
    expect(options.headers).toMatchObject({ "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength('{"query":"搜索"}')) });
    combined = options.signal;
    return Object.assign(new EventEmitter(), { end: (payload: string) => {
      expect(payload).toBe('{"query":"搜索"}');
      const response = Object.assign(new EventEmitter(), { statusCode: 200 });
      callback(response);
      response.emit("data", Buffer.from('{"results":[]}'));
      response.emit("end");
    } });
  });
  await expect(publicHttpPost("https://provider.example/search", {}, { query: "搜索" }, 1000, controller.signal))
    .resolves.toMatchObject({ ok: true, body: '{"results":[]}' });
  expect(combined?.aborted).toBe(false);
  controller.abort();
  expect(combined?.aborted).toBe(true);
});

it("never follows POST redirects or opens a connection to a private endpoint", async () => {
  const response = Object.assign(new EventEmitter(), { statusCode: 307, headers: { location: "https://evil.example" }, destroy: vi.fn() });
  transport.request.mockImplementation((_url, _options, callback) => Object.assign(new EventEmitter(), { end: () => callback(response) }));
  await expect(publicHttpPost("https://provider.example/search", { Authorization: "Bearer fixture" }, {}, 1000)).rejects.toThrow("重定向");
  expect(transport.request).toHaveBeenCalledOnce();
  await expect(publicHttpPost("http://127.0.0.1/search", {}, {}, 1000)).rejects.toThrow();
  expect(transport.request).toHaveBeenCalledOnce();
});

it("uses the timeout signal to abort an unfinished POST", async () => {
  transport.request.mockImplementation((_url, options) => {
    const request = Object.assign(new EventEmitter(), { end: vi.fn() });
    options.signal.addEventListener("abort", () => request.emit("error", options.signal.reason), { once: true });
    return request;
  });
  await expect(publicHttpPost("https://provider.example/search", {}, {}, 10)).rejects.toThrow();
});
