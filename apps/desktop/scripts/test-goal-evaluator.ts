import assert from "node:assert/strict";
import {
  buildGoalContinuePrompt,
  buildGoalEvalPrompt,
  buildGoalTranscript,
  parseGoalEvalResponse,
} from "../electron/agent/goal-evaluator.ts";
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

console.log("test-goal-evaluator: ok");
