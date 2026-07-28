import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  excludeUserAgentsHomeSkills,
  getUserAgentsSkillsRoot,
  isUnderUserAgentsSkills,
} from "../electron/agent/exclude-agents-home-skills";

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

console.log("test-exclude-agents-home-skills: ok");
