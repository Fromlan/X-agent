/** Mutation tests prove omitted/failed quality checks and publication dependency bypasses are rejected. */
import { expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { readFileSync } from "node:fs";
import { assertReleaseWorkflow } from "../scripts/check-release-workflow";
const source = readFileSync(new URL("../../../.github/workflows/release.yml", import.meta.url), "utf8");
it("accepts the current immutable gated release graph", () => expect(() => assertReleaseWorkflow(source)).not.toThrow());
it.each(["npm test", "npm run test:coverage", "npm run test:e2e", "npm run test:godot"])("rejects a missing or ignored gate: %s", (command) => {
  const doc = parse(source);
  const step = doc.jobs.release.steps.find((s: { run?: string }) => s.run === command);
  step["continue-on-error"] = true;
  expect(() => assertReleaseWorkflow(stringify(doc))).toThrow(/bypassable/);
  doc.jobs.release.steps = doc.jobs.release.steps.filter((s: { run?: string }) => s.run !== command);
  expect(() => assertReleaseWorkflow(stringify(doc))).toThrow(/missing/);
});
it("rejects publication independent of validation or running regardless of failure", () => {
  const doc = parse(source); delete doc.jobs.publish.needs;
  expect(() => assertReleaseWorkflow(stringify(doc))).toThrow(/require/);
  doc.jobs.publish.needs = "release"; doc.jobs.publish.if = "always()";
  expect(() => assertReleaseWorkflow(stringify(doc))).toThrow(/bypass/);
});
