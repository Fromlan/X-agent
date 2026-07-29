import {
  applySkillSlashInsert,
  detectSkillSlash,
  filterSkillsByQuery,
} from "../src/lib/skill-slash";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// detect — start of input
{
  const m = detectSkillSlash("/", 1);
  assert(m !== null && m.query === "" && m.start === 0, "bare slash");
}

{
  const m = detectSkillSlash("/x-gr", 5);
  assert(m !== null && m.query === "x-gr" && m.start === 0, "query after slash");
}

{
  const m = detectSkillSlash("hello /skill", 12);
  assert(m !== null && m.query === "skill" && m.start === 6, "after space");
}

{
  const m = detectSkillSlash("hello/skill", 11);
  assert(m === null, "no slash without boundary");
}

{
  const m = detectSkillSlash("/x-grill more", 13);
  assert(m === null, "space ends slash fragment at cursor end");
}

{
  const m = detectSkillSlash("/x-grill more", 8);
  assert(m !== null && m.query === "x-grill", "cursor mid-fragment after /x-grill");
}

// filter
{
  const skills = [
    { name: "x-grill", description: "Interview the user" },
    { name: "godot-scene-edit", description: "Edit scenes" },
  ];
  assert(filterSkillsByQuery(skills, "").length === 2, "empty query");
  assert(
    filterSkillsByQuery(skills, "grill")[0]?.name === "x-grill",
    "filter name",
  );
  assert(
    filterSkillsByQuery(skills, "scenes")[0]?.name === "godot-scene-edit",
    "filter description",
  );
  assert(filterSkillsByQuery(skills, "zzz").length === 0, "no match");
}

// insert
{
  const match = detectSkillSlash("/x", 2)!;
  const out = applySkillSlashInsert("/x", match, "x-grill");
  assert(out.value === "/skill:x-grill ", "insert replaces fragment");
  assert(out.cursor === "/skill:x-grill ".length, "cursor after token");
}

{
  const value = "please /x then";
  // cursor right after /x (index 9)
  const match = detectSkillSlash(value, 9)!;
  assert(match.query === "x", "partial in middle");
  const out = applySkillSlashInsert(value, match, "x-tdd");
  assert(out.value === "please /skill:x-tdd  then", "preserves suffix");
}

console.log("test-skill-slash: ok");
