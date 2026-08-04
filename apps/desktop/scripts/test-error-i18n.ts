/**
 * Offline assertions for `shared/error-i18n.ts`.
 *
 * Covers every known failure mode (auth / rate / quota / 5xx / network /
 * context / abort / unknown), JSON-body extraction from upstream payloads,
 * and the fallback for unrecognised inputs.
 */

import assert from "node:assert/strict";
import { inspectError, translateError } from "../shared/error-i18n";

function check(raw: unknown, expectedPatternId: string | null, expectedContains: string): void {
  const got = inspectError(raw);
  assert.equal(
    got.patternId,
    expectedPatternId,
    `pattern id mismatch for ${JSON.stringify(raw)}: got ${got.patternId}`,
  );
  assert.ok(
    got.message.includes(expectedContains),
    `message for ${JSON.stringify(raw)} should contain "${expectedContains}", got "${got.message}"`,
  );
}

// --- 1. Auth failures (the 401 the user hit) ------------------------------
check(
  '401 {"error":{"message":"Authentication Fails, Your api key: ****e560 is invalid","type":"authentication_error","param":null,"code":"invalid_request_error"}}',
  "auth_failed",
  "认证失败",
);

check(
  'Invalid API key: sk-xxx is incorrect',
  "auth_invalid_key",
  "API Key 无效",
);

check(
  "403 Forbidden: your token is expired",
  "permission_denied",
  "权限不足",
);

// --- 2. Rate / quota ------------------------------------------------------
check("429 Too Many Requests", "rate_limit", "限流");
check("Rate limit exceeded for gpt-4o", "rate_limit", "限流");
check("Insufficient quota: please upgrade your plan", "quota_exceeded", "余额");
check("insufficient_balance: please top up", "quota_exceeded", "余额");

// --- 3. Server 5xx --------------------------------------------------------
check("502 Bad Gateway", "server_5xx", "5xx");
check("503 Service Unavailable", "server_5xx", "5xx");
check("500 Internal Server Error", "server_5xx", "5xx");

// --- 3b. DeepSeek error codes (https://api-docs.deepseek.com/...) -------
// 400 — 格式错误
check("400 - 格式错误", "bad_request", "请求格式错误");
check("Format Error: malformed JSON in request body", "bad_request", "请求格式错误");
// 401 already covered above (auth_failed)
// 402 — 余额不足
check("402 - 余额不足", "quota_exceeded", "余额不足");
check("Insufficient balance on your account", "quota_exceeded", "余额不足");
// 422 — 参数错误
check("422 - 参数错误", "invalid_params", "参数错误");
check("Invalid parameter: temperature must be between 0 and 2", "invalid_params", "参数错误");
// 429 already covered above (rate_limit)
// 500 — 服务器故障
check("500 - 服务器故障", "server_5xx", "供应商服务异常");
// 503 — 服务器繁忙
check("503 - 服务器繁忙", "server_5xx", "供应商服务异常");
// English JSON shape DeepSeek-compatible gateways emit
check(
  '402 {"error":{"code":402,"message":"Insufficient Balance","type":"insufficient_balance_error"}}',
  "quota_exceeded",
  "余额不足",
);

// --- 4. Network -----------------------------------------------------------
check("Error: connect ETIMEDOUT 1.2.3.4:443", "network_timeout", "网络超时");
check("getaddrinfo ENOTFOUND api.openai.com", "network_dns", "DNS");
check("connect ECONNREFUSED 127.0.0.1:8080", "network_refused", "网络连接");
check("read ECONNRESET", "network_refused", "网络连接");

// --- 5. Model / context ---------------------------------------------------
check(
  "Error: context_length_exceeded: maximum context length is 8192 tokens",
  "context_overflow",
  "上下文超限",
);
check("prompt is too long for this model", "context_overflow", "上下文");
check("Error: 404 model_not_found: gpt-99", "model_not_found", "模型不存在");

// --- 6. Abort -------------------------------------------------------------
check("Request aborted by user", "aborted", "中止");
check("Operation cancelled", "aborted", "中止");

// --- 7. Unknown inputs are prefixed but never thrown ----------------------
const unknownRaw = "Some vendor-specific nonsense we don't recognise yet";
const unknown = inspectError(unknownRaw);
assert.equal(unknown.patternId, null, "unknown should report patternId=null");
assert.ok(
  unknown.message.startsWith("未识别错误："),
  `unknown should be prefixed, got: ${unknown.message}`,
);
assert.ok(
  unknown.message.includes(unknownRaw),
  "unknown should still carry the original text for support",
);

// --- 8. Edge cases --------------------------------------------------------
assert.equal(translateError(null), "未知错误");
assert.equal(translateError(""), "未知错误");
assert.equal(translateError(undefined), "未知错误");

// Non-string inputs are coerced, not thrown on — numbers / objects get the
// generic fallback so we never throw at the chat boundary.
assert.ok(translateError(42).startsWith("未识别错误"), "number → unknown fallback");
assert.ok(
  translateError({ code: 42 }).startsWith("未识别错误"),
  "object → unknown fallback",
);

// --- 9. JSON body extraction ---------------------------------------------
// When the status code is missing the extraction should still find a
// useful inner message.
const noStatusCode = JSON.stringify({
  error: { message: "Authentication Fails" },
});
const inspected = inspectError(noStatusCode);
assert.equal(inspected.patternId, "auth_failed", "bare JSON body should still match");

console.log("test-error-i18n: ok");