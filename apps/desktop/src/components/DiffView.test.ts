/**
 * DiffView 纯解析逻辑单测 —— parseDiffLines 的行分类 / 统计 / CRLF 归一。
 */
import { describe, it, expect } from "vitest";
import { parseDiffLines } from "./DiffView";

describe("parseDiffLines", () => {
  it("classifies meta / hunk / add / del / ctx lines", () => {
    const text = [
      "diff --git a/a.ts b/a.ts",
      "index 123..456 100644",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,3 +1,3 @@",
      " import x",
      "-const a = 1;",
      "+const a = 2;",
      " export x",
      "",
    ].join("\n");
    const { lines, fileCount, added, removed } = parseDiffLines(text);
    expect(fileCount).toBe(1);
    expect(added).toBe(1);
    expect(removed).toBe(1);
    expect(lines[0]!.kind).toBe("meta");
    expect(lines[1]!.kind).toBe("meta");
    expect(lines[2]!.kind).toBe("meta");
    expect(lines[3]!.kind).toBe("meta");
    expect(lines[4]!.kind).toBe("hunk");
    expect(lines[5]!.kind).toBe("ctx");
    expect(lines[6]!.kind).toBe("del");
    expect(lines[7]!.kind).toBe("add");
    expect(lines[8]!.kind).toBe("ctx");
    expect(lines[9]!.kind).toBe("ctx");
  });

  it("counts multiple files and strips CRLF", () => {
    const text =
      "diff --git a/x.ts b/x.ts\r\n@@ -1 +1 @@\r\n-old\r\n+new\r\ndiff --git a/y.ts b/y.ts\r\n@@ -1 +1 @@\r\n-old2\r\n+new2\r\n";
    const { fileCount, added, removed, lines } = parseDiffLines(text);
    expect(fileCount).toBe(2);
    expect(added).toBe(2);
    expect(removed).toBe(2);
    expect(lines[1]!.text).toBe("@@ -1 +1 @@");
  });

  it("handles binary files and empty input", () => {
    const bin = parseDiffLines("diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n");
    expect(bin.fileCount).toBe(1);
    expect(bin.lines[1]!.kind).toBe("meta");

    const empty = parseDiffLines("");
    expect(empty.lines).toEqual([{ kind: "ctx", text: "" }]);
    expect(empty.fileCount).toBe(0);
  });
});
