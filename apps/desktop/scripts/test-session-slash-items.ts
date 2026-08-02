import { buildSessionSlashItems } from "../electron/agent/session-slash-items";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

{
  const items = buildSessionSlashItems({
    commands: [{ name: "godot-rpc-status", description: "RPC hint" }],
    prompts: [
      { name: "x-next", description: "Next step", argumentHint: "[focus]" },
      { name: "godot-next", description: "Godot next" },
    ],
    skills: [
      { name: "x-grill", description: "Interview" },
      { name: "x-tdd", description: "TDD" },
    ],
  });
  assert(items.length === 5, "all five present");
  assert(items[0]?.source === "command", "commands first");
  assert(items[1]?.source === "prompt", "prompts after commands");
  assert(items[3]?.source === "skill", "skills last group");
  const xNext = items.find((i) => i.name === "x-next");
  assert(xNext?.argumentHint === "[focus]", "keeps argumentHint");
}

{
  const items = buildSessionSlashItems({
    commands: [{ name: "shared", description: "cmd" }],
    prompts: [{ name: "shared", description: "prompt" }],
    skills: [{ name: "shared", description: "skill" }],
  });
  assert(items.length === 1, "dedupe by name");
  assert(items[0]?.source === "command", "command wins over prompt/skill");
}

{
  const items = buildSessionSlashItems({
    commands: [],
    prompts: [{ name: "alpha", description: "a" }, { name: "Beta", description: "b" }],
    skills: [{ name: "zeta", description: "z" }, { name: "aardvark", description: "aa" }],
  });
  const prompts = items.filter((i) => i.source === "prompt").map((i) => i.name);
  const skills = items.filter((i) => i.source === "skill").map((i) => i.name);
  assert(prompts.join(",") === "alpha,Beta", "prompt name order");
  assert(skills.join(",") === "aardvark,zeta", "skill name order");
}

{
  const items = buildSessionSlashItems({
    commands: [{ name: "  ", description: "empty" }, { name: "ok", description: "" }],
    prompts: [],
    skills: [],
  });
  assert(items.length === 1 && items[0]?.name === "ok", "skips blank names");
}

console.log("test-session-slash-items: ok");
