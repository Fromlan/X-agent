/** Make bounded HTTP probes with connection-time DNS validation and no redirects. */
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { validateExternalHttpUrl } from "./external-url";

export type PublicAddress = { address: string; family: number };
export type PublicResolver = (hostname: string) => Promise<PublicAddress[]>;

/** Check each returned address with the same public-only policy used for literal URLs. */
export function publicAddresses(addresses: PublicAddress[]): boolean {
  return addresses.length > 0 && addresses.every(({ address, family }) =>
    isIP(address) === family && (family === 4 || family === 6) && validateExternalHttpUrl(`http://${family === 6 ? `[${address}]` : address}/`).ok,
  );
}

/** Resolve once for the socket and return only validated addresses; Node cannot re-resolve the host. */
export function createPublicLookup(resolveHost: PublicResolver = (host) => lookup(host, { all: true, verbatim: true })): LookupFunction {
  return (hostname, options, callback) => {
    void resolveHost(hostname).then((addresses) => {
      if (!publicAddresses(addresses)) {
        callback(new Error("域名解析到本地或私有网络地址"), "");
        return;
      }
      const candidates = options.family ? addresses.filter((a) => a.family === options.family) : addresses;
      if (!candidates.length) { callback(new Error("域名无可用公网地址"), ""); return; }
      if (options.all) callback(null, candidates);
      else callback(null, candidates[0].address, candidates[0].family);
    }, () => callback(new Error("域名无法解析"), ""));
  };
}

/** GET a public endpoint; preserve TLS hostname checks, reject all redirects, bound bytes and total time. */
export function publicHttpGet(url: string, headers: Record<string, string>, timeoutMs: number): Promise<{ ok: boolean; status: number; body: string }> {
  return publicHttpRequest(url, headers, timeoutMs);
}

/** POST JSON through the same public-only transport, including caller cancellation. */
export function publicHttpPost(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<{ ok: boolean; status: number; body: string }> {
  const payload = JSON.stringify(body);
  return publicHttpRequest(url, {
    ...headers, "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(payload)),
  }, timeoutMs, payload, signal);
}

/** Pin DNS at connection time and bound the entire response for either HTTP method. */
function publicHttpRequest(url: string, headers: Record<string, string>, timeoutMs: number, payload?: string, signal?: AbortSignal): Promise<{ ok: boolean; status: number; body: string }> {
  const checked = validateExternalHttpUrl(url);
  if (!checked.ok) return Promise.reject(new Error(checked.error));
  const target = new URL(checked.href);
  if (target.username || target.password) return Promise.reject(new Error("URL 不允许包含认证信息"));
  return new Promise((resolve, reject) => {
    const request = target.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(target, {
      method: payload === undefined ? "GET" : "POST", headers, agent: false,
      lookup: createPublicLookup(),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.destroy(); reject(new Error("外部请求不允许 HTTP 重定向，请填写最终公网 URL")); return;
      }
      const chunks: Buffer[] = []; let bytes = 0;
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) { res.destroy(new Error("接口响应超过 2 MiB")); return; }
        chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("end", () => resolve({ ok: status >= 200 && status < 300, status, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(payload);
  });
}
