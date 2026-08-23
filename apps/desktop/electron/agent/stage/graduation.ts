/**
 * Stage graduation checks.
 *
 * Each stage declares a list of GraduationCheck (file-exists / file-count /
 * glob-count / manual). When the user attempts to switch stages, we run
 * every check and surface the result in the StageSwitchModal. v1 is
 * "建议但不强制" — the user can confirm even with unmet checks.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { STAGE_DEFINITIONS } from "../../../shared/stage-defs";
import type {
  GraduationCheck,
  GraduationCheckResult,
  GraduationStatus,
  ProjectStage,
  StageId,
} from "../../../shared/stage";
import { nextStage } from "../../../shared/stage";

const MAX_GLOB_FILES = 1000;

function listFilesRecursive(
  root: string,
  pattern: RegExp,
  max: number,
): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  const stack = [root];
  while (stack.length > 0 && out.length < max) {
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
        if (entry === ".git" || entry === "node_modules" || entry === ".godot") {
          continue;
        }
        stack.push(full);
      } else if (st.isFile()) {
        if (pattern.test(entry)) out.push(full);
        if (out.length >= max) break;
      }
    }
  }
  return out;
}

function globToRegExp(pattern: string): RegExp {
  // Very small glob: only `*` and `?` wildcards against the basename.
  const re = pattern
    .split("")
    .map((ch) => {
      if (ch === "*") return "[^/]*";
      if (ch === "?") return "[^/]";
      if (/[.+^$(){}|\\[\]]/.test(ch)) return `\\${ch}`;
      return ch;
    })
    .join("");
  return new RegExp(`^${re}$`);
}

function evaluateCheck(
  check: GraduationCheck,
  cwd: string,
  artifactsDir: string,
  manualChecks: Record<string, boolean>,
): GraduationCheckResult {
  const baseDir = artifactsDir && artifactsDir.length > 0
    ? join(cwd, artifactsDir)
    : cwd;

  if (check.kind === "manual") {
    const passed = manualChecks[check.id] === true;
    return {
      id: check.id,
      label: check.label,
      passed,
      detail: passed ? "已勾选" : "未勾选（主观判断）",
    };
  }

  const pattern = check.pattern ?? "*";
  const re = globToRegExp(pattern);

  if (check.kind === "file-exists") {
    if (!existsSync(baseDir)) {
      return { id: check.id, label: check.label, passed: false, detail: `目录不存在：${baseDir}` };
    }
    const files = listFilesRecursive(baseDir, re, 1);
    const passed = files.length > 0;
    return {
      id: check.id,
      label: check.label,
      passed,
      detail: passed ? files[0] : "未找到匹配文件",
    };
  }

  if (check.kind === "file-count" || check.kind === "glob-count") {
    if (!existsSync(baseDir)) {
      return { id: check.id, label: check.label, passed: false, detail: `目录不存在：${baseDir}` };
    }
    const files = listFilesRecursive(baseDir, re, MAX_GLOB_FILES);
    const min = check.min ?? 1;
    const passed = files.length >= min;
    return {
      id: check.id,
      label: check.label,
      passed,
      detail: `${files.length} / ${min}（${pattern}）`,
    };
  }

  return { id: check.id, label: check.label, passed: false, detail: "未知检查类型" };
}

/** Run all graduation checks for a stage and return a UI-ready status. */
export function evaluateGraduation(
  cwd: string,
  stage: StageId,
  projectStage: ProjectStage,
): GraduationStatus {
  const def = STAGE_DEFINITIONS[stage];
  const checks = def.graduation.map((c) =>
    evaluateCheck(c, cwd, def.artifactsDir, projectStage.manualChecks),
  );
  const passed = checks.filter((c) => c.passed).length;
  return {
    current: stage,
    next: nextStage(stage),
    checks,
    passed,
    total: checks.length,
    allPassed: checks.length > 0 && passed === checks.length,
    canSkip: true, // v1: 用户选择"建议不强制"
  };
}
