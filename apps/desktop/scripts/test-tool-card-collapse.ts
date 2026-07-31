import assert from "node:assert/strict";
import { toolDetailsOpenForDoneTransition } from "../src/components/ToolCard";

assert.equal(toolDetailsOpenForDoneTransition(false, false), true);
assert.equal(toolDetailsOpenForDoneTransition(true, false), true);
assert.equal(toolDetailsOpenForDoneTransition(false, true), false);
assert.equal(toolDetailsOpenForDoneTransition(true, true), null);

console.log("test-tool-card-collapse: ok");
