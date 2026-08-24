#!/usr/bin/env node
/**
 * test-commit-msg-lint.mjs
 *
 * Tiny self-test runner for scripts/commit-msg-lint.mjs.
 * Run from the repo root:
 *
 *   node scripts/test-commit-msg-lint.mjs
 *
 * Each case is { name, message, expectCode }. The script writes the
 * message to a temp file, invokes the linter, and checks the exit code.
 *
 * Exit 0 on all pass; exit 1 on first failure.
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LINT = join(__dirname, "commit-msg-lint.mjs");

const cases = [
  // Accepted
  { name: "feat with scope + CJK subject", message: "feat(gui): 新增快捷键面板", expectCode: 0 },
  { name: "fix without scope", message: "fix: 修崩溃", expectCode: 0 },
  { name: "docs: imperative subject", message: "docs(readme): explain the release flow", expectCode: 0 },
  { name: "release: bumping", message: "release: v0.6.0", expectCode: 0 },
  { name: "breaking-change marker", message: "feat(api)!: drop legacy config", expectCode: 0 },
  { name: "scope with dot/dash/underscore", message: "feat(godot-rpc.bridge): new method", expectCode: 0 },
  { name: "multi-line body", message: "fix(gui): close modal on Esc\n\nLonger body here.\n\nFixes #123", expectCode: 0 },

  // Rejected
  { name: "empty message", message: "", expectCode: 1 },
  { name: "whitespace only", message: "   \n  \n", expectCode: 1 },
  { name: "plain sentence", message: "add new panel", expectCode: 1 },
  { name: "type capitalised", message: "Feat: x", expectCode: 1 },
  { name: "unknown type", message: "wip: doing things", expectCode: 1 },
  { name: "subject ends with period", message: "fix: repair thing.", expectCode: 1 },
  { name: "subject starts with capital (ASCII)", message: "fix: Repair thing", expectCode: 1 },
  { name: "empty subject after colon", message: "fix: ", expectCode: 1 },
  { name: "scope with space", message: "feat(gui panel): x", expectCode: 1 },
  { name: "scope with capital", message: "feat(GUI): x", expectCode: 1 },
];

const tmp = mkdtempSync(join(tmpdir(), "cml-test-"));
let passed = 0;
let failed = 0;

try {
  for (const c of cases) {
    const file = join(tmp, `msg-${passed + failed}.txt`);
    writeFileSync(file, c.message, "utf8");
    const res = spawnSync(process.execPath, [LINT, file], {
      encoding: "utf8",
      // node spawnSync treats the path as a path; use a URL to be safe
    });
    const actual = res.status;
    if (actual === c.expectCode) {
      console.log(`  ok    ${c.name}`);
      passed += 1;
    } else {
      console.error(
        `  FAIL  ${c.name}\n` +
          `        expected exit ${c.expectCode}, got ${actual}\n` +
          `        message: ${JSON.stringify(c.message)}\n` +
          (res.stdout ? `        stdout: ${res.stdout.trim()}\n` : "") +
          (res.stderr ? `        stderr: ${res.stderr.trim()}\n` : ""),
      );
      failed += 1;
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
