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

// Published model IDs only: numeric suffixes can denote a different model generation.
// Checked 2026-11-16: platform.claude.com/docs/en/build-with-claude/context-windows.
const CLAUDE_1M_MODELS = new Set([
  "claude-opus-4-6", "claude-opus-4-7", "claude-opus-4-8", "claude-sonnet-4-6",
  "claude-opus-5", "claude-opus-5-5", "claude-sonnet-5", "claude-sonnet-5-5", "claude-haiku-5-5",
  "claude-fable-5", "claude-fable-5-1", "claude-fable-5-2",
  "claude-mythos-5", "claude-mythos-5-1", "claude-mythos-5-2", "claude-mythos-preview",
]);

const CLAUDE_200K_MODELS = new Set([
  "claude-sonnet-4", "claude-sonnet-4-5", "claude-opus-4", "claude-opus-4-1", "claude-opus-4-5",
  "claude-haiku-4-5", "claude-3-sonnet", "claude-3-haiku", "claude-3-opus",
  "claude-3-5-sonnet", "claude-3-5-haiku", "claude-3-7-sonnet",
]);

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

  // DeepSeek V4 family 与 flash — 1M native context (同步 DeepSeek 当前 lineup)。
  // flash 与 V4 共享 1M 上下文;chat / reasoner / V3 / R1 仍走 128k 分支。
  if (
    n.includes("deepseek-v4") ||
    n.includes("deepseek_v4") ||
    n.includes("deepseek-flash") ||
    n.includes("deepseek_flash")
  ) {
    return 1_000_000;
  }

  // Retired aliases are endpoint-dependent; only versioned V3/R1 get this fallback.
  if (
    n.includes("deepseek-v3") ||
    n.includes("deepseek_v3") ||
    n === "deepseek-r1" ||
    n.startsWith("deepseek-r1")
  ) {
    return 128_000;
  }

  // Strip only explicit metadata suffixes before matching a published model ID.
  if (n.includes("claude")) {
    const claudeId = n.replace(/(?:\[1m\]|-1m)$/, "").replace(/-(?:20\d{6}|latest)$/, "");
    if (CLAUDE_1M_MODELS.has(claudeId)) return 1_000_000;
    // Sonnet 4/4.5's 1M beta retired on 2026-04-30; a label cannot restore it.
    // Source: platform.claude.com/docs/en/release-notes/overview#april-30-2026.
    if (CLAUDE_200K_MODELS.has(claudeId)) return 200_000;
    return undefined;
  }

  // OpenAI
  // API windows, not Codex's effective input budget. Sources: developers.openai.com/api/docs/models/.
  if (/^gpt-5\.4(?:-pro)?(?:$|-\d{4}-\d{2}-\d{2}$)/.test(n)) return 1_050_000;
  if (/^gpt-5(?:\.[12])?(?:-mini|-nano|-pro|-codex)?(?:$|-\d{4}-\d{2}-\d{2}$)/.test(n)) return 400_000;
  if (/^gpt-4\.1(?:-mini|-nano)?(?:$|-\d{4}-\d{2}-\d{2}$)/.test(n)) {
    return 1_047_576;
  }
  if (
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
    // M3 上下文窗口 1M,M2.x 系列 204_800
    if (n.includes("minimax-m3") || n.endsWith("-m3")) return 1_000_000;
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
  "max_context_length",
] as const;

export type ModelContextSource = "explicit" | "api" | "catalog";

/** Parse an independent input ceiling without claiming it is the full context window. */
export function parseMaxInputTokensFromApiModel(raw: unknown): number | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const model = raw as Record<string, unknown>;
  const metadata = model.metadata && typeof model.metadata === "object" ? model.metadata as Record<string, unknown> : {};
  return normalizePositiveInt(model.max_input_tokens) ?? normalizePositiveInt(metadata.max_input_tokens);
}

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
export function enrichModelEntry<
  T extends { id: string; name?: string; contextWindow?: number; contextWindowSource?: ModelContextSource; input?: ("text" | "image")[] },
>(model: T): T & { contextWindow?: number; contextWindowSource?: ModelContextSource } {
  const contextWindow = resolveModelContextWindow({
    id: model.id,
    explicit: model.contextWindowSource === "catalog" ? undefined : model.contextWindow,
  });
  if (contextWindow == null) {
    const { contextWindow: _drop, contextWindowSource: _source, ...rest } = model;
    return rest as T;
  }
  const contextWindowSource = normalizePositiveInt(model.contextWindow) !== undefined && model.contextWindowSource !== "catalog"
    ? model.contextWindowSource ?? "explicit"
    : "catalog";
  return { ...model, contextWindow, contextWindowSource };
}
