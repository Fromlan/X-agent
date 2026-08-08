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
  silicon.length === 1 && silicon[0] === "https://api.siliconflow.cn/v1/models",
  "siliconflow",
);

const withV1 = buildModelsUrlCandidates("https://api.example.com/v1");
assert(withV1[0] === "https://api.example.com/v1/models", "trailing v1");

const deepseek = buildModelsUrlCandidates("https://api.deepseek.com/anthropic");
assert(
  deepseek.includes("https://api.deepseek.com/v1/models") &&
    deepseek.includes("https://api.deepseek.com/anthropic/v1/models"),
  "strip anthropic",
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

console.log("test-model-fetch: ok");
