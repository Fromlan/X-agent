import {
  splitUserMessageFileBlocks,
  userMessageHasCmdBlocks,
  userMessageHasEmbeddedBlocks,
  userMessageHasFileBlocks,
  userMessageHasModeBlocks,
  userMessageHasPromptBlocks,
  userMessageHasSkillBlocks,
} from "../src/lib/user-message-files";
import { collapseFileBlocksToAtPaths } from "../src/lib/expandAtPaths";
import { wrapWithModeBlock } from "../shared/mode-prompt";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

{
  assert(!userMessageHasFileBlocks("hello @foo"), "no blocks");
  assert(
    userMessageHasFileBlocks('<file name="a.md">\nx\n</file>'),
    "has block",
  );
  assert(
    userMessageHasModeBlocks('<mode name="plan">\nx\n</mode>'),
    "has mode",
  );
  assert(
    userMessageHasEmbeddedBlocks('<mode name="plan">\nx\n</mode>'),
    "embedded",
  );
}

{
  const segs = splitUserMessageFileBlocks(
    '看这个\n<file name="assets/ASSETS_INDEX.md">\n# title\nline2\n</file>\n谢谢',
  );
  assert(segs.length === 3, `3 segments got ${segs.length}`);
  assert(segs[0]?.kind === "text" && segs[0].text === "看这个\n", "lead text");
  assert(
    segs[1]?.kind === "file" &&
      segs[1].name === "assets/ASSETS_INDEX.md" &&
      segs[1].content === "# title\nline2",
    "file block",
  );
  assert(segs[2]?.kind === "text" && segs[2].text === "\n谢谢", "trail text");
}

{
  const segs = splitUserMessageFileBlocks("plain only");
  assert(segs.length === 1 && segs[0]?.kind === "text", "plain");
}

{
  const segs = splitUserMessageFileBlocks(
    '<file name="a.ts">\nconst x = 1;\n</file><file name="b.ts">\nconst y = 2;\n</file>',
  );
  assert(segs.length === 2, "two files");
  assert(segs[0]?.kind === "file" && segs[0].name === "a.ts", "first");
  assert(segs[1]?.kind === "file" && segs[1].name === "b.ts", "second");
}

{
  // Build (and legacy) mode blocks still render as chips.
  const wrapped = wrapWithModeBlock("build", "Implement plan.\nRead first.", "");
  const segs = splitUserMessageFileBlocks(wrapped);
  assert(segs.length === 1, `build-only got ${segs.length}`);
  assert(
    segs[0]?.kind === "mode" &&
      segs[0].name === "build" &&
      segs[0].content.includes("Implement"),
    "build chip",
  );
}

{
  const mixed =
    '<mode name="build">\nbuild only\n</mode>\n\n看\n<file name="a.md">\nx\n</file>';
  const segs = splitUserMessageFileBlocks(mixed);
  assert(segs.length === 3, `mixed got ${segs.length}`);
  assert(segs[0]?.kind === "mode", "mode first");
  assert(segs[1]?.kind === "text", "mid text");
  assert(segs[2]?.kind === "file" && segs[2].name === "a.md", "file last");
}

{
  const collapsed = collapseFileBlocksToAtPaths(
    '请看\n<file name="assets/ASSETS_INDEX.md">\n# big\ncontent\n</file>\n继续',
  );
  assert(
    collapsed === "请看\n@assets/ASSETS_INDEX.md\n继续",
    `collapse got ${JSON.stringify(collapsed)}`,
  );
  assert(
    collapseFileBlocksToAtPaths("no files @here") === "no files @here",
    "passthrough",
  );
  const withMode = collapseFileBlocksToAtPaths(
    wrapWithModeBlock("build", "instr", "请实施") +
      '\n<file name="a.md">\nx\n</file>',
  );
  assert(
    withMode.trim() === "请实施\n@a.md",
    `strip mode+file got ${JSON.stringify(withMode)}`,
  );
  assert(!withMode.includes("<mode"), "no mode left");
  assert(!withMode.includes("<file"), "no file left");
}

{
  const skill =
    '<skill name="x-grill" location="/tmp/x-grill/SKILL.md">\nReferences are relative to /tmp/x-grill.\n\n# grill\n</skill>';
  assert(userMessageHasSkillBlocks(skill), "has skill");
  const segs = splitUserMessageFileBlocks(skill);
  assert(segs.length === 1, "skill only");
  assert(
    segs[0]?.kind === "skill" &&
      segs[0].name === "x-grill" &&
      segs[0].content.includes("# grill"),
    "skill chip",
  );
  assert(
    collapseFileBlocksToAtPaths(skill) === "/skill:x-grill",
    "collapse skill to slash",
  );
}

{
  const prompt =
    '<prompt name="x-next" args="战斗">\nInspect. Focus: 战斗\n</prompt>\n\nextra';
  assert(userMessageHasPromptBlocks(prompt), "has prompt");
  const segs = splitUserMessageFileBlocks(prompt);
  assert(segs.length === 2, `prompt+text got ${segs.length}`);
  assert(
    segs[0]?.kind === "prompt" &&
      segs[0].name === "x-next" &&
      segs[0].args === "战斗",
    "prompt chip",
  );
  assert(segs[1]?.kind === "text" && segs[1].text.includes("extra"), "trail");
  assert(
    collapseFileBlocksToAtPaths(prompt) === "/x-next 战斗\n\nextra",
    `collapse prompt got ${JSON.stringify(collapseFileBlocksToAtPaths(prompt))}`,
  );
}

{
  assert(
    userMessageHasEmbeddedBlocks(
      '<prompt name="x-next">\nbody\n</prompt>',
    ),
    "prompt is embedded",
  );
}

{
  // <cmd> block — emitted by Pi extension command handlers (e.g. /init).
  // Renders as a compact chip parallel to <skill> / <prompt>.
  const cmd = '<cmd name="init">\n/bootstrap instructions here\n</cmd>';
  assert(userMessageHasCmdBlocks(cmd), "has cmd");
  assert(userMessageHasEmbeddedBlocks(cmd), "cmd is embedded");
  const segs = splitUserMessageFileBlocks(cmd);
  assert(segs.length === 1, `cmd only got ${segs.length}`);
  assert(
    segs[0]?.kind === "cmd" &&
      segs[0]?.name === "init" &&
      segs[0]?.content === "/bootstrap instructions here",
    "cmd chip",
  );
}

{
  // <cmd> block 跟其它 block 混排
  const mixed =
    '<cmd name="init">\nbody\n</cmd>\n请看\n<file name="a.md">\nx\n</file>';
  const segs = splitUserMessageFileBlocks(mixed);
  assert(segs.length === 3, `cmd+text+file got ${segs.length}`);
  assert(segs[0]?.kind === "cmd" && segs[0]?.name === "init", "cmd first");
  assert(segs[1]?.kind === "text" && segs[1]?.text.includes("请看"), "mid text");
  assert(segs[2]?.kind === "file" && segs[2]?.name === "a.md", "file last");
}

console.log("test-user-message-files: ok");
