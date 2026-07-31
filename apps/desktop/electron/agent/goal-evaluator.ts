/**
 * Goal-mode evaluator: independent yes/no check against a completion condition.
 */
import { extractMessageText } from "./transcript-mapper";

export const GOAL_TRANSCRIPT_MAX_CHARS = 12_000;

export type GoalEvalResult = {
  met: boolean;
  reason: string;
};

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
