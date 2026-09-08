/**
 * Goal-mode evaluator: independent yes/no check against a completion condition.
 *  - parse / build prompt
 *  - selectEvaluatorModel: pref set → use it; pref unset → fall back to session.
 */
import assert from "node:assert/strict";
import {
  buildGoalContinuePrompt,
  buildGoalEvalPrompt,
  buildGoalTranscript,
  parseEvaluatorModelSpec,
  parseGoalEvalResponse,
  selectEvaluatorModel,
} from "../electron/agent/session-mode/goal-evaluator.ts";
import { buildGoalModeSystemAppend } from "../shared/mode-prompt.ts";

assert.deepEqual(parseGoalEvalResponse("YES\nAll tests passed"), {
  met: true,
  reason: "All tests passed",
});
assert.deepEqual(parseGoalEvalResponse("NO\nLint still failing"), {
  met: false,
  reason: "Lint still failing",
});
assert.equal(parseGoalEvalResponse("YES: done").met, true);
assert.equal(parseGoalEvalResponse("NO — missing file").met, false);
assert.equal(parseGoalEvalResponse("").met, false);
assert.equal(parseGoalEvalResponse("maybe later").met, false);

const transcript = buildGoalTranscript([
  { role: "user", content: [{ type: "text", text: "fix auth" }] },
  { role: "assistant", content: [{ type: "text", text: "done" }] },
  { role: "system", content: [{ type: "text", text: "ignore" }] },
]);
assert.ok(transcript.includes("USER:"));
assert.ok(transcript.includes("ASSISTANT:"));
assert.ok(!transcript.includes("ignore"));

const evalPrompt = buildGoalEvalPrompt("tests pass", "USER: hi");
assert.ok(evalPrompt.includes("GOAL CONDITION"));
assert.ok(evalPrompt.includes("tests pass"));

const cont = buildGoalContinuePrompt("tests pass", "still red");
assert.ok(!cont.includes("<mode"));
assert.ok(cont.includes("still red"));
assert.ok(cont.includes("tests pass"));

const append = buildGoalModeSystemAppend("all tests green");
assert.ok(append.includes("# X-agent Goal mode"));
assert.ok(append.includes("all tests green"));
assert.ok(append.includes("GOAL CONDITION"));

// ===== Issue #1: parseEvaluatorModelSpec =====
assert.deepEqual(
  parseEvaluatorModelSpec("anthropic/claude-haiku-4-5"),
  { provider: "anthropic", modelId: "claude-haiku-4-5" },
  "happy path",
);
assert.deepEqual(
  parseEvaluatorModelSpec("  openai/gpt-4o-mini  "),
  { provider: "openai", modelId: "gpt-4o-mini" },
  "trims surrounding whitespace",
);
assert.equal(parseEvaluatorModelSpec(""), null, "empty string");
assert.equal(parseEvaluatorModelSpec(null), null, "null");
assert.equal(parseEvaluatorModelSpec(undefined), null, "undefined");
assert.equal(parseEvaluatorModelSpec("no-slash"), null, "no slash");
assert.equal(parseEvaluatorModelSpec("/missing-provider"), null, "no provider");
assert.equal(parseEvaluatorModelSpec("missing-model/"), null, "no modelId");

// ===== Issue #1: selectEvaluatorModel =====
const sessionModel = {
  id: "big",
  provider: "anthropic",
  cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1,
  maxTokens: 1,
  api: "anthropic-messages",
  name: "big",
  baseUrl: "",
  reasoning: false,
  input: ["text"],
} as never;
const prefModel = {
  id: "haiku",
  provider: "anthropic",
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1,
  maxTokens: 1,
  api: "anthropic-messages",
  name: "haiku",
  baseUrl: "",
  reasoning: false,
  input: ["text"],
} as never;
const fakeRuntime = {
  getModel: (provider: string, id: string) => {
    if (provider === "anthropic" && id === "claude-haiku-4-5") {
      return prefModel;
    }
    return undefined;
  },
} as never;

// 1. no pref → use session model
{
  const s = selectEvaluatorModel({
    runtime: fakeRuntime,
    sessionModel,
    pref: null,
  });
  assert.equal(s.source, "session", "no pref → session");
  assert.equal(s.model, sessionModel, "no pref → session model");
  assert.equal(s.prefRequested, null);
}

// 2. pref set, runtime resolves → use pref
{
  const s = selectEvaluatorModel({
    runtime: fakeRuntime,
    sessionModel,
    pref: "anthropic/claude-haiku-4-5",
  });
  assert.equal(s.source, "pref", "pref set + resolved → pref");
  // helper returns the narrow {id, provider} projection of the resolved model
  assert.deepEqual(
    s.model,
    { id: "haiku", provider: "anthropic" },
    "pref set + resolved → narrow {id, provider} projection",
  );
  assert.equal(s.prefRequested, "anthropic/claude-haiku-4-5");
}

// 3. pref set, runtime does not resolve → fallback to session
{
  const s = selectEvaluatorModel({
    runtime: fakeRuntime,
    sessionModel,
    pref: "anthropic/does-not-exist",
  });
  assert.equal(s.source, "fallback", "pref unresolved → fallback");
  assert.equal(s.model, sessionModel, "pref unresolved → session model");
  assert.equal(s.prefRequested, "anthropic/does-not-exist");
}

// 4. pref set but unparseable → treat as no pref
{
  const s = selectEvaluatorModel({
    runtime: fakeRuntime,
    sessionModel,
    pref: "  /missing-provider  ",
  });
  assert.equal(s.source, "session", "unparseable pref → session");
  assert.equal(s.model, sessionModel);
}

// 5. pref set but runtime not ready → fallback (keeps caller from crashing)
{
  const s = selectEvaluatorModel({
    runtime: null,
    sessionModel,
    pref: "anthropic/claude-haiku-4-5",
  });
  assert.equal(s.source, "fallback", "no runtime + pref → fallback");
  assert.equal(s.model, sessionModel);
}

console.log("test-goal-evaluator: ok");
