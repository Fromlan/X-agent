/**
 * Validate URLs before shell.openExternal.
 * Blocks non-http(s) and loopback / link-local / private hosts (phishing + SSRF).
 * Public https hosts remain allowed so markdown / docs links keep working.
 */

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.",
  "0.0.0.0",
  "::1",
  "[::1]",
  "metadata.google.internal",
]);

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

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return true;
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "ipv6-localhost" || host.startsWith("fe80:")) return true;
  if (isIpv4(host) && isPrivateOrLocalIpv4(host)) return true;
  // IPv6 unique-local / loopback
  if (host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd")) {
    return true;
  }
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
