import assert from "node:assert/strict";
import {
  formatClarifyReply,
  parseClarifyBlocks,
} from "../src/lib/plan-clarify.ts";

const text = [
  "Need a few choices:",
  "<clarify>",
  "Q: Which renderer?",
  "- Forward+",
  "- Mobile",
  "- Either",
  "</clarify>",
  "",
  "<clarify>",
  "Q: Scope?",
  "1. MVP",
  "2. Full",
  "</clarify>",
].join("\n");

const qs = parseClarifyBlocks(text);
assert.equal(qs.length, 2);
assert.equal(qs[0].question, "Which renderer?");
assert.deepEqual(qs[0].options, ["Forward+", "Mobile", "Either"]);
assert.equal(qs[1].options.length, 2);

assert.equal(parseClarifyBlocks("no blocks").length, 0);
assert.equal(
  parseClarifyBlocks("<clarify>\nQ: Only one?\n- A\n</clarify>").length,
  0,
  "need >=2 options",
);

const reply = formatClarifyReply([
  { question: "Which renderer?", option: "Mobile" },
]);
assert.ok(reply.includes("Which renderer?"));
assert.ok(reply.includes("→ Mobile"));

console.log("test-plan-clarify: ok");
