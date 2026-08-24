#!/usr/bin/env node
/**
 * commit-msg-lint.mjs
 *
 * Local commit-msg gate. Validates that the message follows
 * Conventional Commits 1.0.0 (https://www.conventionalcommits.org/):
 *
 *   <type>(<scope>): <subject>
 *
 * Allowed types are listed in `ALLOWED_TYPES` below. The scope is
 * optional but encouraged. The subject must be non-empty and use
 * imperative mood; no trailing period.
 *
 * Reject rules:
 *   - Empty / whitespace-only message
 *   - Missing `<type>:` prefix
 *   - Unknown type
 *   - Subject starts with uppercase or ends with `.`
 *   - First line exceeds 100 characters (soft cap; warnings only)
 *
 * Exit codes:
 *   0 — message is acceptable
 *   1 — message violates a hard rule
 *   2 — usage / IO error
 *
 * Usage:
 *   node scripts/commit-msg-lint.mjs <path-to-commit-msg-file>
 *   # invoked by .githooks/commit-msg (see scripts/git-hooks/commit-msg)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ALLOWED_TYPES = new Set([
  "feat",
  "fix",
  "docs",
  "chore",
  "refactor",
  "test",
  "perf",
  "build",
  "ci",
  "style",
  "release",
]);

const MAX_FIRST_LINE = 100; // soft cap; warn-only
const SCOPE_PATTERN = /^[a-z0-9][a-z0-9._-]*$/; // lowercase, dot/underscore/dash ok

function fail(message) {
  console.error(`[commit-msg-lint] ${message}`);
  process.exit(1);
}

function warn(message) {
  console.warn(`[commit-msg-lint] ${message}`);
}

function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: node scripts/commit-msg-lint.mjs <commit-msg-file>");
    process.exit(2);
  }

  let raw;
  try {
    raw = readFileSync(resolve(target), "utf8");
  } catch (err) {
    fail(`cannot read commit message file ${target}: ${err.message}`);
  }

  // git may pass a commit message that contains comment lines (lines
  // starting with `#`); strip those before validation.
  const lines = raw.split(/\r?\n/);
  const meaningful = lines.filter((l) => !l.startsWith("#") && l.length > 0);
  const subject = meaningful[0] ?? "";

  if (!subject.trim()) {
    fail("commit message is empty");
  }

  // Conventional Commits grammar:
  //   <type>(<scope>)?: <subject>
  //   <type>!: <subject>   (breaking change marker — accepted, treated as same type)
  const m = subject.match(/^([a-z]+)(\([^)]+\))?(!)?: (.*)$/);
  if (!m) {
    fail(
      [
        `commit subject does not match Conventional Commits:`,
        `  got:      "${subject}"`,
        `  expected: "<type>(<scope>): <subject>"`,
        `  example:  "feat(gui): 新增快捷键面板"`,
        ``,
        `Allowed types: ${[...ALLOWED_TYPES].join(", ")}`,
      ].join("\n"),
    );
  }

  const [, type, scopeGroup, bang, body] = m;
  if (!ALLOWED_TYPES.has(type)) {
    fail(
      `unknown type "${type}". Allowed: ${[...ALLOWED_TYPES].join(", ")}`,
    );
  }

  if (scopeGroup) {
    const scope = scopeGroup.slice(1, -1);
    if (!SCOPE_PATTERN.test(scope)) {
      fail(
        `scope "${scope}" must match ${SCOPE_PATTERN.source} (lowercase, digits, dot/underscore/dash)`,
      );
    }
  }

  if (bang) {
    warn(
      `breaking-change marker (!) detected; please also describe it in the body footer as "BREAKING CHANGE: <reason>"`,
    );
  }

  if (body.length === 0) {
    fail("subject is empty after the colon");
  }

  if (body.endsWith(".")) {
    fail("subject must not end with a period");
  }

  if (/^[A-Z]/.test(body)) {
    // subject should be lowercase / start with lowercase or CJK
    if (/^[A-Z][a-z]/.test(body)) {
      // ASCII capital at start; likely a sentence-style subject — reject
      fail(
        `subject must start with a lowercase letter or non-Latin character (got "${body}")`,
      );
    }
  }

  if (subject.length > MAX_FIRST_LINE) {
    warn(
      `first line is ${subject.length} chars (>${MAX_FIRST_LINE}); consider splitting into a subject + body`,
    );
  }

  process.exit(0);
}

main();
