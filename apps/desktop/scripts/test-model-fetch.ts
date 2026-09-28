import {
  buildModelsUrlCandidates,
  fetchProviderModels,
  parseModelsJson,
} from "../electron/agent/model-fetch";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const silicon = buildModelsUrlCandidates("https://api.siliconflow.cn");
assert(
  silicon.length === 2 &&
    silicon[0] === "https://api.siliconflow.cn/models" &&
    silicon[1] === "https://api.siliconflow.cn/v1/models",
  "siliconflow: /models 优先 + /v1/models 兜底",
);

const withV1 = buildModelsUrlCandidates("https://api.example.com/v1");
assert(withV1[0] === "https://api.example.com/v1/models", "trailing v1");

const deepseek = buildModelsUrlCandidates("https://api.deepseek.com/anthropic");
assert(
  deepseek.includes("https://api.deepseek.com/v1/models") &&
    deepseek.includes("https://api.deepseek.com/anthropic/v1/models") &&
    deepseek.includes("https://api.deepseek.com/models") &&
    deepseek.includes("https://api.deepseek.com/anthropic/models"),
  "strip anthropic: 同时含 4 个候选",
);
assert(deepseek[0] === "https://api.deepseek.com/anthropic/models", "anthropic /models 优先");
assert(deepseek[1] === "https://api.deepseek.com/anthropic/v1/models", "anthropic /v1/models 兜底");

const deepseekHost = buildModelsUrlCandidates("https://api.deepseek.com");
assert(
  deepseekHost[0] === "https://api.deepseek.com/models",
  "deepseek bare host -> /models 优先",
);
assert(
  deepseekHost.includes("https://api.deepseek.com/v1/models"),
  "deepseek bare host -> /v1/models 兜底",
);

const zhipu = buildModelsUrlCandidates(
  "https://open.bigmodel.cn/api/coding/paas/v4",
);
assert(zhipu[0] === "https://open.bigmodel.cn/api/coding/paas/v4/models", "zhipu v4");

const override = buildModelsUrlCandidates(
  "https://api.deepseek.com/anthropic",
  false,
  "https://api.deepseek.com/models",
);
assert(override.length === 1 && override[0].endsWith("/models"), "override");

const parsed = parseModelsJson({
  data: [
    { id: "foo", owned_by: "org", context_length: 64000 },
    { id: "deepseek-v4-flash" },
    { id: "  " },
  ],
});
assert(parsed.length === 2, "parse skips empty id");
const foo = parsed.find((m) => m.id === "foo");
assert(foo?.contextWindow === 64_000, "parse uses API context_length");
const flash = parsed.find((m) => m.id === "deepseek-v4-flash");
assert(flash?.contextWindow === 1_000_000, "parse falls back to lookup");

// SSRF gate: localhost / loopback / non-http(s) base URLs are rejected
// before any network request is made (static checks only, stays offline).
async function expectRejected(baseUrl: string, label: string): Promise<void> {
  const res = await fetchProviderModels({ baseUrl, apiKey: "k" });
  assert(res.ok === false, `${label} must be rejected`);
  assert(/不允许|仅支持/.test(res.error ?? ""), `${label} error mentions the rule`);
}

await expectRejected("http://127.0.0.1:11434", "loopback base url");
await expectRejected("http://localhost:8080", "localhost base url");
await expectRejected("http://[::ffff:7f00:1]:8080", "mapped-ipv6 base url");
await expectRejected("file:///etc/passwd", "non-http base url");



// DeepSeek 扩展 /v1/models schema 端到端样本
import { effortToThinkingLevelMap } from "../electron/agent/model-fetch";
const ds = parseModelsJson({
  object: "list",
  data: [
    {
      id: "deepseek-flash",
      owned_by: "deepseek-ai",
      context_window: 1000000,
      max_output_tokens: 8192,
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
      effort: { supported_levels: ["high"], default_level: "high" },
      api_capabilities: {
        anthropic_messages: { system_prompt_update: "leading-only" },
      },
    },
  ],
});
assert(ds.length === 1, "deepseek parse count");
assert(ds[0]?.id === "deepseek-flash", "deepseek id");
assert(ds[0]?.contextWindow === 1_000_000, "deepseek context_window");
assert(ds[0]?.maxOutputTokens === 8192, "deepseek max_output_tokens");
assert(
  JSON.stringify(ds[0]?.input) === JSON.stringify(["text", "image"]),
  "deepseek input_modalities",
);
assert(ds[0]?.effort?.supportedLevels?.[0] === "high", "deepseek effort supportedLevels");
assert(
  JSON.stringify(ds[0]?.thinkingLevelMap) ===
    JSON.stringify({
      off: "off",
      minimal: "high",
      low: "high",
      medium: "high",
      high: "high",
      max: "high",
    }),
  "deepseek effort -> off-only thinkingLevelMap",
);

// effort 多档翻译 (非 DeepSeek, 但确保通用逻辑)
const multi = effortToThinkingLevelMap(["low", "medium", "high"]);
assert(multi.low === "low", "multi low");
assert(multi.medium === "medium", "multi medium");
assert(multi.high === "high", "multi high");
assert(multi.max === "high", "multi max -> last supported");

// OpenAI 标准响应回退
const gpt = parseModelsJson({ data: [{ id: "gpt-4o", owned_by: "openai" }] });
assert(gpt[0]?.maxOutputTokens === undefined, "gpt-4o maxOutputTokens undefined");
assert(gpt[0]?.thinkingLevelMap === undefined, "gpt-4o thinkingLevelMap undefined");
assert(gpt[0]?.contextWindow === 128000, "gpt-4o contextWindow lookup fallback");

console.log("test-model-fetch: ok");

