/** Verify the independent evaluator sees actual execution evidence rather than assistant claims. */
import { expect, it } from "vitest";
import { buildGoalEvidence, validateGoalDecision } from "./goal-evaluator";

const yes = { met: true, reason: "done" };
it("does not accept an executable goal based only on assistant self-report", () => {
  const evidence = buildGoalEvidence([{ role: "assistant", content: [{ type: "text", text: "Tests passed" }] }]);
  expect(validateGoalDecision("tests pass", evidence, yes).met).toBe(false);
});
it("retains call IDs and failed results even when the assistant says success", () => {
  const evidence = buildGoalEvidence([
    { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "npm test" } }] },
    { role: "toolResult", toolName: "bash", toolCallId: "call-1", isError: true, content: [{ type: "text", text: "exit 1: assertions failed" }] },
    { role: "assistant", content: [{ type: "text", text: "All tests pass" }] },
  ]);
  expect(evidence.transcript).toContain("call-1"); expect(evidence.transcript).toContain("assertions failed");
  expect(validateGoalDecision("tests pass", evidence, yes).met).toBe(false);
});
it("allows corrected deterministic evidence and explicitly marks omitted history", () => {
  const evidence = buildGoalEvidence([
    { role: "user", content: "old context ".repeat(2000) },
    { role: "toolResult", toolName: "bash", toolCallId: "1", isError: true, content: "exit 1" },
    { role: "toolResult", toolName: "bash", toolCallId: "2", isError: false, content: "exit 0: 35 tests passed" },
  ], 800);
  expect(evidence.transcript.length).toBeLessThanOrEqual(800);
  expect(evidence.omitted).toBe(true); expect(evidence.transcript).toContain("EVIDENCE OMITTED");
  expect(validateGoalDecision("tests pass", evidence, yes).met).toBe(true);
});
