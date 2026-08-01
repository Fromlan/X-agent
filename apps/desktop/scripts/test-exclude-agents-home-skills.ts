import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  excludeUserAgentsHomeSkills,
  getUserAgentsSkillsRoot,
  isUnderUserAgentsSkills,
} from "../electron/agent/exclude-agents-home-skills";
import {
  applyXAgentSkillsFilter,
  dedupeSkillsByName,
  filterGodotSkillsForCwd,
  isGodotProjectRoot,
  skillIdForFilter,
  truncateSkillDescription,
  SKILL_INDEX_DESCRIPTION_MAX,
} from "../electron/agent/filter-session-skills";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const root = getUserAgentsSkillsRoot();
assert(
  root === resolve(join(homedir(), ".agents", "skills")),
  "root matches ~/.agents/skills",
);

assert(isUnderUserAgentsSkills(root), "root itself");
assert(
  isUnderUserAgentsSkills(join(root, "foo", "SKILL.md")),
  "nested skill file",
);
assert(
  !isUnderUserAgentsSkills(join(homedir(), ".pi", "agent", "skills", "x", "SKILL.md")),
  "pi agent skills not excluded",
);
assert(
  !isUnderUserAgentsSkills(join("D:", "proj", ".agents", "skills", "x", "SKILL.md")),
  "project .agents/skills not excluded",
);
assert(!isUnderUserAgentsSkills(""), "empty path");

const filtered = excludeUserAgentsHomeSkills([
  { filePath: join(root, "design-taste", "SKILL.md"), name: "a" },
  { filePath: join(homedir(), ".pi", "agent", "skills", "mine", "SKILL.md"), name: "b" },
  { filePath: join("C:", "work", ".pi", "skills", "p", "SKILL.md"), name: "c" },
]);
assert(filtered.length === 2, "only home agents skill dropped");
assert(
  filtered.every((s) => s.name !== "a"),
  "home agents skill removed",
);

assert(skillIdForFilter({ name: "x-grill" }) === "x-grill", "name preferred");
assert(
  skillIdForFilter({
    filePath: join("pkg", "skills", "godot-docs-4-7", "SKILL.md"),
  }) === "godot-docs-4-7",
  "id from parent dir",
);

const sample = [
  { name: "x-grill", filePath: join("p", "x-grill", "SKILL.md") },
  { name: "godot-docs-4-7", filePath: join("p", "godot-docs-4-7", "SKILL.md") },
];

assert(!isGodotProjectRoot(""), "empty cwd not godot");
assert(
  !isGodotProjectRoot(join(homedir(), "definitely-not-a-godot-project-xyz")),
  "random cwd not godot",
);

const nonGodot = filterGodotSkillsForCwd(sample, join(homedir(), "no-godot-here"));
assert(nonGodot.length === 1, "only core skill kept without project.godot");
assert(nonGodot[0]!.name === "x-grill", "x-grill retained");

const godotTmp = mkdtempSync(join(tmpdir(), "x-agent-godot-"));
try {
  writeFileSync(join(godotTmp, "project.godot"), "config_version=5\n", "utf8");
  assert(isGodotProjectRoot(godotTmp), "tmp godot root");
  const withGodot = filterGodotSkillsForCwd(sample, godotTmp);
  assert(withGodot.length === 2, "all skills when godot project");
} finally {
  rmSync(godotTmp, { recursive: true, force: true });
}

const mixed = applyXAgentSkillsFilter(sample, join(homedir(), "no-godot-here"));
assert(mixed.length === 1, "pipeline drops home godot + godot-tier");
assert(mixed[0]!.name === "x-grill", "pipeline keeps core");

const homeOnly = [
  { name: "x-tdd", filePath: join(homedir(), ".pi", "agent", "skills", "x-tdd", "SKILL.md") },
  { name: "stray", filePath: join(root, "stray", "SKILL.md") },
];
const afterHome = applyXAgentSkillsFilter(homeOnly, join(homedir(), "no-godot"));
assert(afterHome.length === 1 && afterHome[0]!.name === "x-tdd", "home agents still excluded");

assert(
  truncateSkillDescription("short") === "short",
  "short description unchanged",
);
const longDesc =
  "A".repeat(SKILL_INDEX_DESCRIPTION_MAX + 40);
const truncated = truncateSkillDescription(longDesc);
assert(
  truncated.length === SKILL_INDEX_DESCRIPTION_MAX,
  "truncated to max length",
);
assert(truncated.endsWith("..."), "ellipsis suffix");

const dupes = [
  {
    name: "x-grill",
    filePath: join("a", "x-grill", "SKILL.md"),
    description: "first",
  },
  {
    name: "x-grill",
    filePath: join("b", "x-grill", "SKILL.md"),
    description: "second",
  },
  {
    name: "x-tdd",
    filePath: join("a", "x-tdd", "SKILL.md"),
    description: "B".repeat(SKILL_INDEX_DESCRIPTION_MAX + 40),
  },
];
const deduped = dedupeSkillsByName(dupes);
assert(deduped.length === 2, "dedupe by name");
assert(deduped[0]!.description === "first", "keeps first");

const indexed = applyXAgentSkillsFilter(dupes, join(homedir(), "no-godot"));
assert(indexed.length === 2, "pipeline dedupes");
assert(
  (indexed.find((s) => s.name === "x-tdd")?.description?.length ?? 0) ===
    SKILL_INDEX_DESCRIPTION_MAX,
  "pipeline truncates description",
);

const withDisabled = applyXAgentSkillsFilter(
  [
    {
      name: "x-grill",
      filePath: join("p", "x-grill", "SKILL.md"),
      description: "a",
    },
    {
      name: "x-tdd",
      filePath: join("p", "x-tdd", "SKILL.md"),
      description: "b",
    },
  ],
  join(homedir(), "no-godot"),
  ["X-Grill", " missing "],
);
assert(withDisabled.length === 1, "disabledSkills drops matching id");
assert(withDisabled[0]!.name === "x-tdd", "unlisted skill kept");

const disabledEmpty = applyXAgentSkillsFilter(
  sample,
  join(homedir(), "no-godot-here"),
  [],
);
assert(
  disabledEmpty.length === mixed.length,
  "empty disabledSkills matches default pipeline",
);

console.log("test-exclude-agents-home-skills: ok");
