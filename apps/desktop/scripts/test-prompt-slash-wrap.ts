import {
  parsePromptArgs,
  substitutePromptArgs,
  wrapPromptSlashAsBlock,
} from "../electron/agent/prompt-slash-wrap";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const templates = [
  {
    name: "x-next",
    content:
      "Inspect this project. Focus area: ${1:-general}.\n\nProvide next step.",
  },
  {
    name: "godot-next",
    content: "Inspect this Godot project. Focus: $1",
  },
];

{
  assert(parsePromptArgs(`a "b c" d`).join("|") === "a|b c|d", "quoted args");
  assert(
    substitutePromptArgs("x=${1:-general}; all=$@", ["combat"]) ===
      "x=combat; all=combat",
    "substitute",
  );
  assert(
    substitutePromptArgs("x=${1:-general}", []) === "x=general",
    "default",
  );
}

{
  const wrapped = wrapPromptSlashAsBlock("/x-next", templates);
  assert(wrapped !== null && wrapped.startsWith('<prompt name="x-next">'), "wrap bare");
  assert(wrapped!.includes("Focus area: general."), "default substituted");
  assert(wrapped!.endsWith("</prompt>"), "closes");
}

{
  const wrapped = wrapPromptSlashAsBlock("/x-next 战斗系统", templates);
  assert(
    wrapped !== null &&
      wrapped.includes('args="战斗系统"') &&
      wrapped.includes("Focus area: 战斗系统."),
    "wrap with args",
  );
}

{
  assert(
    wrapPromptSlashAsBlock("/skill:x-grill", templates) === null,
    "skills not wrapped",
  );
  assert(
    wrapPromptSlashAsBlock("/unknown", templates) === null,
    "unknown not wrapped",
  );
  assert(
    wrapPromptSlashAsBlock("plain text", templates) === null,
    "plain not wrapped",
  );
}

console.log("test-prompt-slash-wrap: ok");
