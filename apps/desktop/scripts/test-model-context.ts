import {
  enrichModelEntry,
  lookupKnownContextWindow,
  normalizeModelId,
  normalizePositiveInt,
  parseContextWindowFromApiModel,
  resolveModelContextWindow,
} from "../shared/model-context";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(normalizeModelId("deepseek-ai/DeepSeek-V4-Flash") === "deepseek-v4-flash", "normalize prefix");
assert(normalizePositiveInt("128000") === 128_000, "parse string");
assert(normalizePositiveInt(0) === undefined, "reject zero");
assert(normalizePositiveInt(-1) === undefined, "reject negative");

assert(lookupKnownContextWindow("deepseek-v4-flash") === 1_000_000, "v4 flash 1M");
assert(lookupKnownContextWindow("deepseek-v4-pro") === 1_000_000, "v4 pro 1M");
assert(
  lookupKnownContextWindow("deepseek-ai/DeepSeek-V4-Pro") === 1_000_000,
  "v4 pro prefixed",
);
assert(lookupKnownContextWindow("deepseek-chat") === 128_000, "chat 128k");
assert(lookupKnownContextWindow("deepseek-reasoner") === 128_000, "reasoner 128k");
assert(
  lookupKnownContextWindow("deepseek-ai/DeepSeek-V3") === 128_000,
  "v3 128k",
);
assert(lookupKnownContextWindow("claude-sonnet-4-5") === 200_000, "claude 200k");
assert(lookupKnownContextWindow("claude-opus-4-7[1m]") === 1_000_000, "claude 1m");
assert(lookupKnownContextWindow("gpt-4o") === 128_000, "gpt-4o");
assert(lookupKnownContextWindow("kimi-k2.7-code") === 256_000, "kimi k2");
assert(lookupKnownContextWindow("totally-unknown-xyz") === undefined, "unknown");

assert(
  parseContextWindowFromApiModel({
    id: "x",
    context_length: 256000,
  }) === 256_000,
  "api context_length",
);
assert(
  parseContextWindowFromApiModel({
    id: "x",
    max_model_len: "65536",
  }) === 65_536,
  "api max_model_len string",
);
assert(
  parseContextWindowFromApiModel({
    id: "x",
    metadata: { context_window: 200000 },
  }) === 200_000,
  "api nested metadata",
);

assert(
  resolveModelContextWindow({
    id: "deepseek-v4-flash",
    explicit: 500_000,
    fromApi: 1_000_000,
  }) === 500_000,
  "explicit wins",
);
assert(
  resolveModelContextWindow({
    id: "deepseek-v4-flash",
    fromApi: 999_000,
  }) === 999_000,
  "api over lookup",
);
assert(
  resolveModelContextWindow({ id: "deepseek-v4-flash" }) === 1_000_000,
  "lookup fallback",
);
assert(
  resolveModelContextWindow({ id: "no-such-model" }) === undefined,
  "no guess",
);

assert(lookupKnownContextWindow("doubao-seed-1-8-251228") === 128_000, "doubao");
assert(
  lookupKnownContextWindow("seedream-3") === undefined,
  "seed alone does not match",
);
assert(lookupKnownContextWindow("mimo-v2-flash") === 128_000, "mimo");
assert(lookupKnownContextWindow("mimosa-bot") === undefined, "no mimo false positive");

const enriched = enrichModelEntry({ id: "deepseek-v4-flash", name: "Flash" });
assert(enriched.contextWindow === 1_000_000, "enrich fills");
const kept = enrichModelEntry({
  id: "deepseek-v4-flash",
  contextWindow: 42_000,
});
assert(kept.contextWindow === 42_000, "enrich keeps explicit");

console.log("test-model-context: ok");
