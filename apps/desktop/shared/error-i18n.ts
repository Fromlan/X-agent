/**
 * Localise raw upstream error strings into a short Chinese description.
 *
 * The chat pipeline surfaces upstream errors as raw English text (e.g.
 * `401 {"error":{"message":"Authentication Fails, Your api key: ****e560
 * is invalid"}}`). Most users can't act on that — they need a one-line
 * Chinese summary that names the failure mode and the next step.
 *
 * Strategy:
 *   1. Try to extract a JSON `error.message` body if the input looks like
 *      `NNN {json}` — that pattern is what Anthropic / OpenAI / most
 *      OpenAI-compatible gateways emit.
 *   2. Pattern-match the cleaned-up string against a small registry of
 *      known failure modes (auth, rate limit, server, network, context,
 *      abort, quota, model not found, timeout). First match wins.
 *   3. Fall back to the original string with a `「未识别错误」` prefix so
 *      the user can still copy/paste it for support.
 *
 * Pure / sync — safe to call from both main and renderer process entry
 * points. The same instance is reused everywhere.
 */

type ErrorPattern = {
  /** Substring or regex tested against the cleaned message. */
  match: RegExp | string;
  /** Stable id used by tests. */
  id: string;
  /** Human-facing Chinese summary. */
  message: string;
};

const PATTERNS: ErrorPattern[] = [
  // 401 / 403 — auth failures.
  {
    id: "auth_invalid_key",
    match:
      /((api[_ ]?key|token|apikey|key)[^a-z]{0,40}(invalid|incorrect|expired|missing|not[_ ]?provided)|(invalid|incorrect|expired|missing)[^a-z]{0,40}(api[_ ]?key|token|apikey|key))/i,
    message: "认证失败：API Key 无效、过期或缺失",
  },
  {
    id: "auth_failed",
    match: /(authentication[_ ]?fail|unauthor(ised|ized)|invalid[_ ]?request[_ ]?error)/i,
    message: "认证失败：API Key 未通过供应商校验",
  },
  {
    id: "permission_denied",
    match: /(permission[_ ]?denied|forbidden|not[_ ]?allowed)/i,
    message: "权限不足：API Key 无权访问该模型或资源",
  },

  // 400 — bad request body (DeepSeek + OpenAI-compatible).
  {
    id: "bad_request",
    match:
      /(\b400\b[^a-z]{0,40}(format[_ ]?error|malformed|invalid[_ ]?request)|format[_ ]?error|malformed|格式[_ ]?错误|请求[_ ]?格式)/i,
    message: "请求格式错误：请检查请求体格式",
  },

  // 402 — DeepSeek uses this for 余额不足 (English gateways say quota/balance).
  {
    id: "quota_exceeded",
    match:
      /(402|quota|insufficient[_ ]?(quota|balance|credits)|余额[_ ]?不足|账号[_ ]?余额|balance)/i,
    message: "余额不足：账户余额或配额不足，请充值或更换 API Key",
  },

  // 422 — DeepSeek uses this for 参数错误 (Anthropic-style gateways too).
  {
    id: "invalid_params",
    match:
      /(\b422\b|parameter[_ ]?(error|invalid)|invalid[_ ]?parameter|参数[_ ]?(错误|无效))/i,
    message: "参数错误：请检查请求体参数是否符合要求",
  },

  // 429 — rate / quota.
  {
    id: "rate_limit",
    match: /(rate[_ ]?limit|too[_ ]?many[_ ]?requests|\b429\b)/i,
    message: "请求过于频繁：触发了供应商限流，稍后重试或降低并发",
  },

  // 5xx — server-side.
  {
    id: "server_5xx",
    match: /\b(5\d\d)\b|internal[_ ]?server[_ ]?error|bad[_ ]?gateway|service[_ ]?unavailable|gateway[_ ]?timeout|服务器[_ ]?(故障|繁忙)/i,
    message: "供应商服务异常：返回 5xx，稍后重试或更换模型",
  },

  // Network.
  {
    id: "network_timeout",
    match: /(timed?[_ ]?out|etimedout|read[_ ]?timeout|connect[_ ]?timeout)/i,
    message: "网络超时：连接供应商失败，检查网络或代理设置",
  },
  {
    id: "network_dns",
    match: /(enotfound|eai_again|getaddrinfo|dns[_ ]?lookup)/i,
    message: "DNS 解析失败：无法连接到供应商域名",
  },
  {
    id: "network_refused",
    match: /(econnrefused|connection[_ ]?refused|connection[_ ]?reset|econnreset)/i,
    message: "网络连接被拒绝或重置",
  },
  {
    id: "network_other",
    match: /(network|fetch|socket|ENETUNREACH|EHOSTUNREACH)/i,
    message: "网络异常：与供应商的连接中断",
  },

  // Model / context.
  {
    id: "context_overflow",
    match:
      /(context[_ ]?(length|window)[_ ]?(exceeded|limit|too)|too[_ ]?many[_ ]?tokens|prompt[_ ]?(is[_ ]?)?too[_ ]?long|max[_ ]?tokens|input[_ ]?too[_ ]?long)/i,
    message: "上下文超限：当前对话超出模型窗口，请「压缩」或新建会话",
  },
  {
    id: "model_not_found",
    match: /(model[_ ]?not[_ ]?found|unknown[_ ]?model|invalid[_ ]?model|does[_ ]?not[_ ]?exist)/i,
    message: "模型不存在：模型标识符在当前供应商不可用",
  },

  // Local / abort.
  {
    id: "aborted",
    match: /\baborted?\b|cancelled|canceled|user[_ ]?abort/i,
    message: "操作已中止",
  },
];

/**
 * Try to extract a JSON body following an HTTP status code, e.g.
 * `401 {...}` → `{...}` (the message inside if present).
 */
function extractJsonBody(raw: string): string | null {
  // Anchor on a leading status code (3 digits) followed by JSON.
  const m = raw.match(/^\s*\d{3}\s+(\{[\s\S]*\})/);
  if (!m) return null;
  const body = m[1];
  try {
    const obj = JSON.parse(body) as { error?: { message?: unknown }; message?: unknown };
    if (obj?.error?.message) return String(obj.error.message);
    if (typeof obj?.message === "string") return obj.message;
  } catch {
    // Body wasn't JSON after all — fall through.
  }
  return body;
}

/**
 * Reduce a raw upstream error string to a stable, Chinese summary.
 * Always returns a non-empty string; never throws.
 */
export function translateError(raw: unknown): string {
  if (raw == null) return "未知错误";
  const text = typeof raw === "string" ? raw : String(raw);
  if (!text.trim()) return "未知错误";

  // Try the JSON body first; if that didn't match, fall back to the raw text.
  const cleaned = extractJsonBody(text) ?? text;

  for (const p of PATTERNS) {
    const hit =
      typeof p.match === "string"
        ? cleaned.toLowerCase().includes(p.match.toLowerCase())
        : p.match.test(cleaned);
    if (hit) return p.message;
  }

  // Unrecognised — prefix so the user knows it's not a translated message
  // and they can still copy the original for support.
  return `未识别错误：${text}`;
}

/**
 * Return both the translated message and the matched pattern id (or null).
 * Useful for tests; renderers can ignore the id.
 */
export function inspectError(raw: unknown): { message: string; patternId: string | null } {
  const text = typeof raw === "string" ? raw : String(raw ?? "");
  const cleaned = extractJsonBody(text) ?? text;
  for (const p of PATTERNS) {
    const hit =
      typeof p.match === "string"
        ? cleaned.toLowerCase().includes(p.match.toLowerCase())
        : p.match.test(cleaned);
    if (hit) return { message: p.message, patternId: p.id };
  }
  return { message: translateError(raw), patternId: null };
}