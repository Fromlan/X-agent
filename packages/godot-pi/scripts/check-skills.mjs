/**
 * Smoke-check godot-pi skills: frontmatter, fixed Core/Godot sets, README coverage.
 * Run: node packages/godot-pi/scripts/check-skills.mjs
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, "..");
const skillsRoot = join(pkgRoot, "skills");
const readmePath = join(pkgRoot, "README.md");

const CORE_SKILLS = [
  "game-plan",
  "game-prototype",
  "game-test",
  "game-expand",
  "x-grill",
  "x-diagnose",
  "x-tdd",
  "x-change-brief",
  "x-handoff",
  "x-glossary",
  "x-review",
  "x-safe-edit",
];

const GODOT_SKILLS = [
  "godot-docs-4-7",
];

const EXPECTED = new Set([...CORE_SKILLS, ...GODOT_SKILLS]);

const knownNonSkill = new Set([
  "godot-next",
  "godot-rpc-status",
  "godot-detect-project",
  "godot-editor-rpc",
  "godot-pi",
  "x-next",
]);

function fail(msg) {
  console.error(`check-skills: ${msg}`);
  process.exitCode = 1;
}

const dirs = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

if (dirs.length === 0) {
  fail("no skill directories found");
}

for (const dir of dirs) {
  if (!EXPECTED.has(dir)) {
    fail(`${dir}: unexpected skill (not in Core/Godot allowlist)`);
  }
  const skillPath = join(skillsRoot, dir, "SKILL.md");
  if (!existsSync(skillPath)) {
    fail(`${dir}: missing SKILL.md`);
    continue;
  }
  const text = readFileSync(skillPath, "utf8");
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) {
    fail(`${dir}: missing YAML frontmatter`);
    continue;
  }
  const name = (fm[1].match(/^name:\s*(.+)$/m) || [])[1]?.trim();
  const description = (fm[1].match(/^description:\s*(.+)$/m) || [])[1]?.trim();
  if (name !== dir) {
    fail(`${dir}: frontmatter name "${name}" !== directory`);
  }
  if (dir.startsWith("godot-") && name && !name.startsWith("godot-")) {
    fail(`${dir}: Godot-tier skill name must start with godot-`);
  }
  if (!dir.startsWith("godot-") && name?.startsWith("godot-")) {
    fail(`${dir}: Core skill must not use godot- prefix`);
  }
  if (!description) {
    fail(`${dir}: missing description`);
  } else if (!/Use when/i.test(description)) {
    fail(`${dir}: description should include "Use when…"`);
  }
}

for (const name of EXPECTED) {
  if (!dirs.includes(name)) {
    fail(`missing required skill: ${name}`);
  }
}

const readme = readFileSync(readmePath, "utf8");
const mentioned = new Set();
for (const m of readme.matchAll(/`([a-z0-9-]+)`/g)) {
  const id = m[1];
  if (id.startsWith("godot-") || id.startsWith("x-") || id.startsWith("game-")) {
    mentioned.add(id);
  }
}

for (const dir of dirs) {
  if (!mentioned.has(dir)) {
    fail(`${dir}: not listed in README.md`);
  }
}

for (const name of mentioned) {
  if (dirs.includes(name) || knownNonSkill.has(name)) continue;
  if (name.startsWith("godot-") || name.startsWith("x-")) {
    fail(`README lists \`${name}\` but no skills/${name}/`);
  }
}

if (!process.exitCode) {
  console.log(
    `check-skills: ok (${dirs.length} skills; core=${CORE_SKILLS.length} godot=${GODOT_SKILLS.length})`,
  );
}
