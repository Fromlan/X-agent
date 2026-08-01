import assert from "node:assert/strict";
import {
  parsePlanTodos,
  togglePlanTodo,
} from "../src/lib/plan-todos.ts";

const md = [
  "# Plan",
  "",
  "## Steps",
  "- [ ] First step",
  "- [x] Done step",
  "* [ ] Star style",
  "not a todo",
].join("\n");

const todos = parsePlanTodos(md);
assert.equal(todos.length, 3);
assert.equal(todos[0].checked, false);
assert.equal(todos[0].text, "First step");
assert.equal(todos[1].checked, true);
assert.equal(todos[2].text, "Star style");

const toggled = togglePlanTodo(md, todos[0].lineIndex);
assert.ok(toggled.includes("- [x] First step"));
const toggledBack = togglePlanTodo(toggled, todos[0].lineIndex, false);
assert.ok(toggledBack.includes("- [ ] First step"));

console.log("test-plan-todos: ok");
