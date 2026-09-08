/**
 * Goal-mode evaluator: independent yes/no check against a completion condition.
 */
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { extractMessageText } from "../../../shared/transcript";

export const GOAL_TRANSCRIPT_MAX_CHARS = 12_000;

export type GoalEvalResult = {
  met: boolean;
  reason: string;
};

/**
 * Minimal shape of the model objects the evaluator passes around. We avoid
 * importing the full generic `Model<TApi>` from `@earendil-works/pi-ai`
 * because the `pi-coding-agent` surface re-exports `ModelRuntime` but not
 * `Model`, and all we need here is the identity (provider + id). The cast
 * to the full type happens at the `runtime.completeSimple` call site.
 */
export type EvaluatorModelLike = {
  id: string;
  provider: string;
};

/**
 * Source of the chosen evaluator model (issue #1):
 * - `"pref"`     → the user's `goalEvaluatorModel` pref resolved to a real model.
 * - `"fallback"` → pref was set but unresolvable; we fell back to the session model.
 * - `"session"`  → no pref, used the session model.
 */
export type EvaluatorModelSource = "pref" | "fallback" | "session";

export type EvaluatorModelSelection = {
  model: EvaluatorModelLike | null;
  source: EvaluatorModelSource;
  /** Echo of the raw pref string, useful for warning messages. */
  prefRequested: string | null;
};

/**
 * Parse a `"<provider>/<modelId>"` string into its parts. Accepts the same
 * shape the TopBar uses (`<provider>/<modelId>`). Returns `null` when the
 * string is missing the slash or has empty sides.
 *
 * We keep parsing in the helper (not in the controller) so the rules are
 * unit-testable without spinning up a real `ModelRuntime`.
 */
export function parseEvaluatorModelSpec(
  spec: string | null | undefined,
): { provider: string; modelId: string } | null {
  if (typeof spec !== "string") return null;
  const trimmed = spec.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash >= trimmed.length - 1) return null;
  const provider = trimmed.slice(0, slash).trim();
  const modelId = trimmed.slice(slash + 1).trim();
  if (!provider || !modelId) return null;
  return { provider, modelId };
}

/**
 * Resolve which model the Goal-mode evaluator should use (issue #1).
 *
 * 1. If the pref is empty/null, use the session model.
 * 2. If the pref is set, parse `<provider>/<modelId>` and look it up via
 *    `ModelRuntime.getModel`. On hit, use it. On miss, fall back to the
 *    session model and report `"fallback"` so the caller can warn the user.
 *
 * `runtime` may be `null` when the host hasn't initialized the runtime yet
 * (e.g. evaluator fires before any session opens); in that case we keep
 * the session model and report `"fallback"`.
 *
 * Note: the returned `model` is narrowed to `{ id; provider }` (no API
 * shape). The caller is responsible for casting to the full `Model<TApi>`
 * when handing it to `runtime.completeSimple`. We use the narrow shape so
 * the helper can be unit-tested without a real `Model` instance.
 */
export function selectEvaluatorModel(opts: {
  runtime: ModelRuntime | null;
  sessionModel: EvaluatorModelLike | null;
  pref: string | null;
}): EvaluatorModelSelection {
  const sessionModel = opts.sessionModel;
  const parsed = parseEvaluatorModelSpec(opts.pref);
  if (!parsed) {
    return {
      model: sessionModel,
      source: "session",
      prefRequested: null,
    };
  }
  if (!opts.runtime) {
    // Pref set but runtime not ready; don't crash. Caller can decide what to
    // do (defer / use session model). Falling back keeps behavior identical
    // to the pre-issue code path.
    return {
      model: sessionModel,
      source: "fallback",
      prefRequested: opts.pref,
    };
  }
  const resolved = opts.runtime.getModel(parsed.provider, parsed.modelId);
  if (resolved) {
    return {
      model: { id: resolved.id, provider: resolved.provider },
      source: "pref",
      prefRequested: opts.pref,
    };
  }
  return {
    model: sessionModel,
    source: "fallback",
    prefRequested: opts.pref,
  };
}

/** Build a compact transcript string from recent session messages. */
export function buildGoalTranscript(
  messages: readonly unknown[],
  maxChars = GOAL_TRANSCRIPT_MAX_CHARS,
): string {
  const lines: string[] = [];
  for (const msg of messages) {
    const role = (msg as { role?: string }).role;
    if (role !== "user" && role !== "assistant") continue;
    const text = extractMessageText(msg).trim();
    if (!text) continue;
    lines.push(`${role.toUpperCase()}: ${text}`);
  }
  let out = lines.join("\n\n");
  if (out.length > maxChars) {
    out = out.slice(out.length - maxChars);
  }
  return out;
}

export function buildGoalEvalPrompt(
  condition: string,
  transcript: string,
): string {
  return [
    "You are a completion evaluator for a coding agent goal.",
    "Decide whether the GOAL condition is already satisfied based ONLY on the transcript evidence.",
    "Do not assume work that is not shown. Look for concrete proof (test output, file contents, confirmation).",
    "",
    `GOAL CONDITION: ${condition}`,
    "",
    "TRANSCRIPT:",
    transcript || "(empty)",
    "",
    "Reply with exactly two lines:",
    "Line 1: YES or NO",
    "Line 2: a short reason (one sentence)",
  ].join("\n");
}

/** Parse model evaluator output into met + reason. */
export function parseGoalEvalResponse(raw: string): GoalEvalResult {
  const text = raw.trim();
  if (!text) {
    return { met: false, reason: "Empty evaluator response" };
  }
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const first = (lines[0] ?? "").toUpperCase();
  const yes =
    first === "YES" ||
    first.startsWith("YES ") ||
    first.startsWith("YES:") ||
    /^YES\b/.test(first);
  const no =
    first === "NO" ||
    first.startsWith("NO ") ||
    first.startsWith("NO:") ||
    /^NO\b/.test(first);
  const reason =
    lines.slice(1).join(" ").trim() ||
    (yes ? "Condition appears met" : no ? "Condition not met" : text.slice(0, 200));
  if (yes && !no) return { met: true, reason };
  if (no) return { met: false, reason };
  // Ambiguous — treat as not met so the loop continues safely.
  return { met: false, reason: `Unclear evaluator reply: ${text.slice(0, 200)}` };
}

/** Short host follow-up when the evaluator says the goal is still unmet. */
export function buildGoalContinuePrompt(
  condition: string,
  reason: string,
): string {
  return [
    `Goal still unmet: ${reason}`,
    `Continue working until this condition holds: ${condition}`,
    "Do not repeat completed steps. Prefer verification (tests/commands) that produce evidence in the transcript.",
  ].join("\n");
}
