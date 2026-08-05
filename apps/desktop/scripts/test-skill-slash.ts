import {
  applySlashItemInsert,
  detectSlashFragment,
  filterSlashItemsByQuery,
} from "../src/lib/slash-menu";
import { parseSkillReadFromTool } from "../src/lib/skill-tool";
import type { SessionSlashItem } from "../shared/ipc";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// detect — start of input
{
  const m = detectSlashFragment("/", 1);
  assert(m !== null && m.query === "" && m.start === 0, "bare slash");
}

{
  const m = detectSlashFragment("/x-gr", 5);
  assert(m !== null && m.query === "x-gr" && m.start === 0, "query after slash");
}

{
  const m = detectSlashFragment("hello /skill", 12);
  assert(m !== null && m.query === "skill" && m.start === 6, "after space");
}

{
  const m = detectSlashFragment("hello/skill", 11);
  assert(m === null, "no slash without boundary");
}

{
  const m = detectSlashFragment("/x-grill more", 13);
  assert(m === null, "space ends slash fragment at cursor end");
}

{
  const m = detectSlashFragment("/x-grill more", 8);
  assert(m !== null && m.query === "x-grill", "cursor mid-fragment after /x-grill");
}

// filter (skills as slash items)
{
  const skills: SessionSlashItem[] = [
    { name: "x-grill", description: "Interview the user", source: "skill" },
    { name: "godot-docs-4-7", description: "Godot docs distilled reference", source: "skill" },
  ];
  assert(filterSlashItemsByQuery(skills, "").length === 2, "empty query");
  assert(
    filterSlashItemsByQuery(skills, "grill")[0]?.name === "x-grill",
    "filter name",
  );
  assert(
    filterSlashItemsByQuery(skills, "docs")[0]?.name === "godot-docs-4-7",
    "filter description",
  );
  assert(filterSlashItemsByQuery(skills, "zzz").length === 0, "no match");
}

// insert
{
  const match = detectSlashFragment("/x", 2)!;
  const out = applySlashItemInsert("/x", match, {
    name: "x-grill",
    description: "",
    source: "skill",
  });
  assert(out.value === "/skill:x-grill ", "insert replaces fragment");
  assert(out.cursor === "/skill:x-grill ".length, "cursor after token");
}

{
  const value = "please /x then";
  // cursor right after /x (index 9)
  const match = detectSlashFragment(value, 9)!;
  assert(match.query === "x", "partial in middle");
  const out = applySlashItemInsert(value, match, {
    name: "x-tdd",
    description: "",
    source: "skill",
  });
  assert(out.value === "please /skill:x-tdd  then", "preserves suffix");
}

// skill read detection (chat special display)
{
  const hit = parseSkillReadFromTool("read", {
    path: "D:/UGit/X-agent/packages/godot-pi/skills/godot-docs-4-7/SKILL.md",
  });
  assert(hit?.skillName === "godot-docs-4-7", "object args skill name");
}

{
  const hit = parseSkillReadFromTool(
    "read",
    JSON.stringify({
      path: "C:\\Users\\x\\.pi\\agent\\skills\\x-grill\\SKILL.md",
    }),
  );
  assert(hit?.skillName === "x-grill", "json string + windows path");
}

{
  assert(
    parseSkillReadFromTool("read", { path: "src/main.gd" }) === null,
    "ordinary read",
  );
  assert(
    parseSkillReadFromTool("bash", {
      path: "skills/foo/SKILL.md",
    }) === null,
    "non-read tool",
  );
  assert(
    parseSkillReadFromTool("read", { path: "notes/SKILL.md.bak" }) === null,
    "not SKILL.md",
  );
}

// unified slash menu (prompts / commands / skills)
{
  const items: SessionSlashItem[] = [
    { name: "godot-rpc-status", description: "RPC hint", source: "command" },
    {
      name: "x-next",
      description: "Next implementation step",
      source: "prompt",
      argumentHint: "[focus area]",
    },
    { name: "x-grill", description: "Interview the user", source: "skill" },
  ];
  assert(
    filterSlashItemsByQuery(items, "next")[0]?.name === "x-next",
    "filter prompt by name",
  );
  assert(
    filterSlashItemsByQuery(items, "focus")[0]?.name === "x-next",
    "filter prompt by argumentHint",
  );
  assert(
    filterSlashItemsByQuery(items, "skill:grill")[0]?.name === "x-grill",
    "filter skill via skill: prefix query",
  );
  assert(
    filterSlashItemsByQuery(items, "rpc")[0]?.source === "command",
    "filter command",
  );

  const match = detectSlashFragment("/x-n", 4)!;
  const promptInsert = applySlashItemInsert("/x-n", match, items[1]!);
  assert(promptInsert.value === "/x-next ", "prompt inserts /name ");

  const cmdMatch = detectSlashFragment("/god", 4)!;
  const cmdInsert = applySlashItemInsert("/god", cmdMatch, items[0]!);
  assert(
    cmdInsert.value === "/godot-rpc-status ",
    "command inserts /name ",
  );

  const skillMatch = detectSlashFragment("/x", 2)!;
  const skillInsert = applySlashItemInsert("/x", skillMatch, items[2]!);
  assert(skillInsert.value === "/skill:x-grill ", "skill keeps /skill: prefix");
}

console.log("test-skill-slash: ok");
