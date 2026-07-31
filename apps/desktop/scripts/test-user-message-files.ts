import {
  splitUserMessageFileBlocks,
  userMessageHasEmbeddedBlocks,
  userMessageHasFileBlocks,
  userMessageHasModeBlocks,
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

console.log("test-user-message-files: ok");
