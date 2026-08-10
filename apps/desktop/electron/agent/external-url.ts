/**
 * Validate URLs before shell.openExternal / outbound model fetches.
 * Blocks non-http(s) and loopback / link-local / private hosts (phishing + SSRF).
 * Public https hosts remain allowed so markdown / docs links keep working.
 * `validateOutboundHttpUrl` additionally resolves hostnames via DNS and
 * rejects any address that maps back to private/local networks.
 */
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.",
  "0.0.0.0",
  "::1",
  "[::1]",
  "metadata.google.internal",
]);

/** Known DNS-rebinding services: the name resolves to whatever you ask it to. */
const REBIND_DOMAIN_SUFFIXES = [
  "localtest.me",
  "nip.io",
  "sslip.io",
  "xip.io",
  "vcap.me",
  "lvh.me",
  "traefik.me",
];

const DNS_TIMEOUT_MS = 3000;

/** 测试闸：跳过 DNS 解析（生产代码永不设置）。 */
let SKIP_DNS_FOR_TESTS = false;
export function setSkipDnsForTests(skip: boolean): void {
  SKIP_DNS_FOR_TESTS = skip;
}

function isIpv4(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

function isPrivateOrLocalIpv4(host: string): boolean {
  const parts = host.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/**
 * Extract the embedded IPv4 from an IPv4-mapped IPv6 host
 * (`::ffff:a.b.c.d` dotted form, or `::ffff:aabb:ccdd` / `::ffff:a00:1`
 * hex-group form — WHATWG URL parsing normalizes the dotted form to hex,
 * e.g. `::ffff:127.0.0.1` → `::ffff:7f00:1`).
 */
function ipv4FromMappedIpv6(host: string): string | null {
  const m = /^::ffff:([0-9a-f:]+)$/i.exec(host);
  if (!m) return null;
  const tail = m[1]!;
  if (isIpv4(tail)) return tail;
  const parts = tail.split(":");
  if (parts.length === 2) {
    const hi = parseInt(parts[0]!, 16);
    const lo = parseInt(parts[1]!, 16);
    if (Number.isFinite(hi) && Number.isFinite(lo)) {
      return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    }
  }
  return null;
}

/**
 * 校验 IPv6 地址是否为受限类:
 * - loopback (`::1` / 等价形式)
 * - IPv4-mapped (`::ffff:a.b.c.d` 及十六进制形态) —— 等价 IPv4 走 `isPrivateOrLocalIpv4`
 * - link-local (`fe80::/10`)
 * - unique-local (`fc00::/7` = `fc` 或 `fd`)
 * - zone-id 形式 (`%eth0` 等) 拒绝任何 zone-id
 */
function isBlockedIpv6(host: string): boolean {
  if (host.includes("%")) return true;
  const mappedV4 = ipv4FromMappedIpv6(host);
  if (mappedV4) return isPrivateOrLocalIpv4(mappedV4);
  // 标准化 0:0:...:0:1 等同 ::1
  const normalized = host.replace(/^0+:/, "::").replace(/:0+/g, ":0");
  if (normalized === "::1" || normalized === "::") return true;
  if (host.startsWith("fe80:") || host.startsWith("fe8") ||
      host.startsWith("fe9") || host.startsWith("fea") ||
      host.startsWith("feb")) return true;
  if (host.startsWith("fc") || host.startsWith("fd")) return true;
  return false;
}

function isRebindHost(host: string): boolean {
  return REBIND_DOMAIN_SUFFIXES.some(
    (s) => host === s || host.endsWith(`.${s}`),
  );
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return true;
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "ipv6-localhost") return true;
  if (isRebindHost(host)) return true;
  const ipKind = isIP(host);
  if (ipKind === 4 && isPrivateOrLocalIpv4(host)) return true;
  if (ipKind === 6 && isBlockedIpv6(host)) return true;
  return false;
}

export function validateExternalHttpUrl(
  url: string,
): { ok: true; href: string } | { ok: false; error: string } {
  const raw = (url ?? "").trim();
  if (!raw) return { ok: false, error: "链接为空" };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "无效链接" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "仅支持 http/https 链接" };
  }
  if (isBlockedHostname(parsed.hostname)) {
    return { ok: false, error: "不允许打开本地或私有网络地址" };
  }
  return { ok: true, href: parsed.toString() };
}

/**
 * True when the hostname resolves (via DNS) to at least one public address
 * and no private / loopback / link-local / metadata address.
 */
async function resolvesToPublicOnly(hostname: string): Promise<boolean> {
  let addrs: { address: string; family: number }[];
  try {
    addrs = (await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DNS 解析超时")), DNS_TIMEOUT_MS),
      ),
    ])) as { address: string; family: number }[];
  } catch {
    return false;
  }
  if (!addrs || addrs.length === 0) return false;
  return addrs.every(({ address }) => {
    const kind = isIP(address);
    if (kind === 4) return !isPrivateOrLocalIpv4(address);
    if (kind === 6) return !isBlockedIpv6(address);
    return false;
  });
}

/**
 * Async URL check for outbound HTTP(S) requests (model fetch etc.).
 * Static checks first (protocol + literal host), then DNS resolution so
 * hostnames like `localtest.me` / `*.nip.io` that resolve to loopback are
 * rejected too. IP-literal hosts skip DNS (already covered statically).
 */
export async function validateOutboundHttpUrl(
  url: string,
): Promise<{ ok: true; href: string } | { ok: false; error: string }> {
  const base = validateExternalHttpUrl(url);
  if (!base.ok) return base;
  const parsed = new URL(base.href);
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) === 0 && !SKIP_DNS_FOR_TESTS) {
    const ok = await resolvesToPublicOnly(host);
    if (!ok) {
      return { ok: false, error: "域名无法解析，或解析到本地 / 私有网络地址" };
    }
  }
  return base;
}
