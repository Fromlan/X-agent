/** Enforce release job dependencies so failed or conditional quality checks cannot publish an installer. */
import { parse } from "yaml";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Step = { run?: string; uses?: string; if?: unknown; "continue-on-error"?: unknown };
type Job = { needs?: string | string[]; if?: unknown; "continue-on-error"?: unknown; permissions?: { contents?: string }; steps?: Step[] };

/** Check the actual YAML job graph and failure policy, rather than matching a list of command strings anywhere in the file. */
export function assertReleaseWorkflow(source: string): void {
  const workflow = parse(source) as { permissions?: { contents?: string }; jobs?: Record<string, Job> };
  const release = workflow.jobs?.release; const publish = workflow.jobs?.publish;
  if (!release || !publish) throw new Error("Release validation and publication must be separate jobs");
  if (release.if !== undefined || release["continue-on-error"] !== undefined || publish.if !== undefined || publish["continue-on-error"] !== undefined) throw new Error("Release jobs must not bypass failed checks");
  const needs = Array.isArray(publish.needs) ? publish.needs : [publish.needs];
  if (!needs.includes("release")) throw new Error("Publication must require the successful validation job");
  if (workflow.permissions?.contents !== "read" || release.permissions?.contents === "write" || publish.permissions?.contents !== "write") throw new Error("Only the publication job may write releases");
  const steps = release.steps ?? [];
  const required = ["npm run typecheck", "npm run lint", "npm test", "npm run test:coverage", "npm run build", "npm run test:e2e", "npm run test:godot"];
  const uploadIndex = steps.findIndex((s) => s.uses?.startsWith("actions/upload-artifact@"));
  for (const command of required) {
    const index = steps.findIndex((s) => s.run?.trim() === command);
    if (index < 0 || uploadIndex <= index || steps[index].if !== undefined || steps[index]["continue-on-error"] !== undefined) throw new Error(`Release gate missing or bypassable: ${command}`);
  }
  const identity = steps.findIndex((s) => s.run?.includes("node scripts/validate-release.mjs"));
  if (identity < 0 || identity >= uploadIndex || steps[identity].if !== undefined || steps[identity]["continue-on-error"] !== undefined) throw new Error("Immutable release identity must be verified before upload");
  if (steps.some((s) => s.run?.includes("npm pkg set"))) throw new Error("Release workflow must not rewrite the checked-out version");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assertReleaseWorkflow(readFileSync(new URL("../../../.github/workflows/release.yml", import.meta.url), "utf8"));
  console.log("lint: release dependency graph and mandatory checks passed");
}
