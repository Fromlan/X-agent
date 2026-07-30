import {
  splitUserMessageFileBlocks,
  userMessageHasFileBlocks,
} from "../src/lib/user-message-files";
import { collapseFileBlocksToAtPaths } from "../src/lib/expandAtPaths";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

{
  assert(!userMessageHasFileBlocks("hello @foo"), "no blocks");
  assert(
    userMessageHasFileBlocks('<file name="a.md">\nx\n</file>'),
    "has block",
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
}

console.log("test-user-message-files: ok");
