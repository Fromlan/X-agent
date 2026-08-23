/**
 * Stage artifact directory and seed templates.
 *
 * Each game stage owns a small, predictable directory under the project's
 * `.x-agent/` folder. This module seeds default templates when a project
 * first enters a stage, so the right-panel stage workbench always has
 * something real to guide from. All operations are idempotent.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { STAGE_DEFINITIONS } from "../../../shared/stage-defs";
import type { ArtifactSummary, StageId } from "../../../shared/stage";
import { ensureStageDir } from "./persistence";

function ensureFile(cwd: string, rel: string, content: string): void {
  const target = join(cwd, rel);
  if (existsSync(target)) return;
  const dir = dirname(target);
  if (dir) mkdirSync(dir, { recursive: true });
  writeFileSync(target, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

const MAX_ARTIFACT_FILES = 200;

function walkFiles(root: string, cap: number): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  const stack = [root];
  while (stack.length > 0 && out.length < cap) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (entry === ".git" || entry === "node_modules" || entry === ".godot") continue;
        stack.push(full);
      } else if (st.isFile()) {
        out.push(full);
        if (out.length >= cap) break;
      }
    }
  }
  return out;
}

function mostRecentMtime(files: string[]): string | null {
  let best: number | null = null;
  for (const f of files) {
    try {
      const t = statSync(f).mtimeMs;
      if (best === null || t > best) best = t;
    } catch {
      /* ignore */
    }
  }
  return best === null ? null : new Date(best).toISOString();
}

/** Create/repair the stage artifact directory and seed templates. Idempotent. */
export function ensureStageArtifacts(cwd: string, stage: StageId): void {
  if (!cwd) return;
  ensureStageDir(cwd);
  switch (stage) {
    case "design":
      ensureFile(
        cwd,
        join(STAGE_DEFINITIONS.design.artifactsDir, "01-gdd.md"),
        [
          "# Game Design Document",
          "",
          "## Core Loop",
          "- ",
          "",
          "## Systems",
          "- ",
          "",
          "## Scope",
          "- 最小可玩切片：",
          "",
          "## Success Criteria",
          "- ",
          "",
        ].join("\n"),
      );
      ensureFile(
        cwd,
        join(STAGE_DEFINITIONS.design.artifactsDir, "config", "gameplay.json"),
        '{\n  "draft": true\n}\n',
      );
      break;
    case "prototype":
      ensureFile(
        cwd,
        join(STAGE_DEFINITIONS.prototype.artifactsDir, "NOTES.md"),
        [
          "# Prototype Notes",
          "",
          "## Vertical Slice",
          "- ",
          "",
          "## Validated",
          "- ",
          "",
          "## Cut / Deferred",
          "- ",
          "",
        ].join("\n"),
      );
      break;
    case "test":
      ensureFile(
        cwd,
        join(STAGE_DEFINITIONS.test.artifactsDir, "bugs.md"),
        [
          "# Bugs & Feedback",
          "",
          "| Status | Title | Steps | Expected | Actual |",
          "| --- | --- | --- | --- | --- |",
          "",
        ].join("\n"),
      );
      ensureFile(
        cwd,
        join(STAGE_DEFINITIONS.test.artifactsDir, "playtest-checklist.md"),
        [
          "# Playtest Checklist",
          "",
          "- [ ] 核心循环可完整走一遍",
          "- [ ] 新手能理解基本操作",
          "- [ ] 没有崩溃或硬阻塞",
          "",
        ].join("\n"),
      );
      break;
    case "expand":
      ensureFile(
        cwd,
        join(STAGE_DEFINITIONS.expand.artifactsDir, "backlog.md"),
        ["# Expansion Backlog", "", "## Tasks", "- [ ] ", ""].join("\n"),
      );
      break;
  }
}

/** Build a summary of the stage's artifact directory for the right panel. */
export function summarizeArtifacts(cwd: string, stage: StageId): ArtifactSummary {
  const def = STAGE_DEFINITIONS[stage];
  const root = def.artifactsDir ? join(cwd, def.artifactsDir) : cwd;
  const files = walkFiles(root, MAX_ARTIFACT_FILES);
  return {
    artifactsDir: def.artifactsDir || ".",
    totalFiles: files.length,
    lastModified: mostRecentMtime(files),
    files: files.map((f) => relative(cwd, f).replaceAll("\\", "/")),
  };
}
