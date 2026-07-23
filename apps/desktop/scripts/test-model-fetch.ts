import { buildModelsUrlCandidates } from "../electron/agent/model-fetch";

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

console.log("test-model-fetch: ok");
