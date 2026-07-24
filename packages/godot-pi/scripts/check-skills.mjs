/**
 * Smoke-check godot-pi skills: frontmatter + README table coverage.
 * Run: node packages/godot-pi/scripts/check-skills.mjs
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, "..");
const skillsRoot = join(pkgRoot, "skills");
const readmePath = join(pkgRoot, "README.md");

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
  if (!description) {
    fail(`${dir}: missing description`);
  } else if (!/Use when/i.test(description)) {
    fail(`${dir}: description should include "Use when…"`);
  }
}

const readme = readFileSync(readmePath, "utf8");
const mentioned = new Set();
for (const m of readme.matchAll(/`([a-z0-9-]+)`/g)) {
  if (m[1].startsWith("godot-")) mentioned.add(m[1]);
}

for (const dir of dirs) {
  if (!mentioned.has(dir)) {
    fail(`${dir}: not listed in README.md`);
  }
}
for (const name of mentioned) {
  if (!dirs.includes(name) && name !== "godot-next") {
    // godot-next is a prompt, not a skill — skip only if not under skills/
    // Extra skill-looking names that aren't dirs:
    if (name.startsWith("godot-") && !name.includes(".")) {
      // allow prompts / tools mentioned elsewhere
      const knownNonSkill = new Set([
        "godot-next",
        "godot-rpc-status",
        "godot-detect-project",
        "godot-editor-rpc",
        "godot-pi",
      ]);
      if (!knownNonSkill.has(name)) {
        fail(`README lists \`${name}\` but no skills/${name}/`);
      }
    }
  }
}

if (!process.exitCode) {
  console.log(`check-skills: ok (${dirs.length} skills)`);
}
