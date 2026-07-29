/**
 * Resolve model context windows for Pi models.json.
 *
 * Priority (resolveModelContextWindow):
 * 1. explicit user/API value
 * 2. known-model heuristic table
 * 3. undefined → leave unset (Pi defaults to 128000)
 */

const VENDOR_PREFIXES = [
  "deepseek-ai/",
  "deepseek/",
  "anthropic/",
  "openai/",
  "google/",
  "meta/",
  "qwen/",
  "zhipuai/",
  "moonshotai/",
  "minimaxai/",
  "minimax/",
  "xiaomi/",
  "baidu/",
  "tencent/",
  "bytedance/",
  "thudm/",
  "01-ai/",
];

/** Positive finite token counts only. */
export function normalizePositiveInt(value: unknown): number | undefined {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.trim())
        : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n);
}

/**
 * Lowercase model id and strip common vendor prefixes / path noise
 * so `deepseek-ai/DeepSeek-V4-Flash` matches `deepseek-v4-flash`.
 */
export function normalizeModelId(id: string): string {
  let s = id.trim().toLowerCase().replace(/\\/g, "/");
  // Keep last path segment if it looks like org/model
  if (s.includes("/")) {
    for (const prefix of VENDOR_PREFIXES) {
      if (s.startsWith(prefix)) {
        s = s.slice(prefix.length);
        break;
      }
    }
  }
  return s.replace(/\s+/g, "");
}

/**
 * Exact / prefix / includes heuristics for common coding models.
 * Values are API-facing context windows (tokens), not "effective" budgets.
 */
export function lookupKnownContextWindow(id: string): number | undefined {
  const n = normalizeModelId(id);
  if (!n) return undefined;

  // DeepSeek V4 family — 1M native context
  if (n.includes("deepseek-v4") || n.includes("deepseek_v4")) {
    return 1_000_000;
  }

  // DeepSeek V3 / chat / reasoner — 128k
  if (
    n === "deepseek-chat" ||
    n === "deepseek-reasoner" ||
    n.includes("deepseek-v3") ||
    n.includes("deepseek_v3") ||
    n === "deepseek-r1" ||
    n.startsWith("deepseek-r1")
  ) {
    return 128_000;
  }

  // Claude: 1M variants, else Sonnet/Opus/Haiku → 200k
  if (n.includes("claude")) {
    if (/\b1m\b/.test(n) || n.includes("-1m") || n.endsWith("1m")) {
      return 1_000_000;
    }
    return 200_000;
  }

  // OpenAI
  if (n.includes("gpt-5")) {
    // GPT-5.x coding models commonly advertise ~272k–400k; use 400k as a
    // conservative public catalog figure when not specified by the API.
    if (n.includes("gpt-5.4") || n.includes("gpt-5.6")) return 400_000;
    return 272_000;
  }
  if (
    n.startsWith("gpt-4.1") ||
    n.startsWith("gpt-4o") ||
    n === "o1" ||
    n.startsWith("o1-") ||
    n.startsWith("o3") ||
    n.startsWith("o4")
  ) {
    return 128_000;
  }

  // Google Gemini
  if (n.includes("gemini")) {
    if (n.includes("2.5") || n.includes("2.0") || n.includes("1.5")) {
      return 1_000_000;
    }
    return 128_000;
  }

  // Kimi / Moonshot
  if (n.includes("kimi") || n.includes("moonshot")) {
    if (n.includes("k2") || n.includes("kimi-for-coding")) return 256_000;
    return 128_000;
  }

  // GLM
  if (n.includes("glm-5") || n.includes("glm5") || n.startsWith("glm-4")) {
    return 128_000;
  }

  // Qwen
  if (n.includes("qwen")) return 128_000;

  // MiniMax
  if (n.includes("minimax")) {
    return 204_800;
  }

  // MiMo (avoid matching unrelated substrings like "mimosa")
  if (n === "mimo" || n.startsWith("mimo-") || n.includes("mimo-v")) {
    return 128_000;
  }

  // StepFun / LongCat / Doubao / Ling / Qianfan — conservative defaults
  if (n.includes("step-")) return 128_000;
  if (n.includes("longcat")) return 128_000;
  if (n.includes("doubao")) return 128_000;
  if (n.startsWith("ling-") || n.includes("ling-1t")) return 128_000;
  if (n.includes("qianfan")) return 128_000;

  // Llama 3.1 70B common hosting default
  if (n.includes("llama-3.1") || n.includes("llama3.1")) return 128_000;

  return undefined;
}

const API_CONTEXT_KEYS = [
  "context_length",
  "context_window",
  "max_model_len",
  "max_input_tokens",
  "max_context_length",
] as const;

/** Read context window from a raw /v1/models data[] entry. */
export function parseContextWindowFromApiModel(
  raw: unknown,
): number | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;

  for (const key of API_CONTEXT_KEYS) {
    const v = normalizePositiveInt(obj[key]);
    if (v != null) return v;
  }

  // Nested shapes used by some gateways
  const meta = obj.metadata;
  if (meta && typeof meta === "object") {
    for (const key of API_CONTEXT_KEYS) {
      const v = normalizePositiveInt((meta as Record<string, unknown>)[key]);
      if (v != null) return v;
    }
  }

  return undefined;
}

export function resolveModelContextWindow(input: {
  id: string;
  explicit?: number | null;
  fromApi?: number | null;
}): number | undefined {
  const explicit = normalizePositiveInt(input.explicit);
  if (explicit != null) return explicit;
  const fromApi = normalizePositiveInt(input.fromApi);
  if (fromApi != null) return fromApi;
  return lookupKnownContextWindow(input.id);
}

/** Attach resolved contextWindow when missing (presets / activate / upsert). */
export function enrichModelEntry<T extends { id: string; name?: string; contextWindow?: number }>(
  model: T,
): T & { contextWindow?: number } {
  const contextWindow = resolveModelContextWindow({
    id: model.id,
    explicit: model.contextWindow,
  });
  if (contextWindow == null) {
    const { contextWindow: _drop, ...rest } = model as T & {
      contextWindow?: number;
    };
    return rest as T;
  }
  return { ...model, contextWindow };
}
