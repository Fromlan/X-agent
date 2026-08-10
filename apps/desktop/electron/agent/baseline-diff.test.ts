/**
 * baseline-diff 单测 —— 无 Git 降级 diff 的纯逻辑（node 环境，不需要 git）。
 * 覆盖：修改 / 新增 / 删除 / 无变化 / 二进制 / 超限 / symlink / 拼接截断。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  baselineDiffTextForEntry,
  isTextLikeBuffer,
  joinBaselineDiffs,
  MAX_DIFF_FILE_BYTES,
} from "./baseline-diff";

let work = "";

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "x-agent-baseline-diff-"));
  mkdirSync(join(work, "sub"), { recursive: true });
});

afterAll(() => {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("isTextLikeBuffer", () => {
  it("detects binary via NUL byte and UTF-8 replacement char", () => {
    expect(isTextLikeBuffer(Buffer.from("hello\nworld", "utf8"))).toBe(true);
    expect(isTextLikeBuffer(Buffer.from([0x68, 0x00, 0x69]))).toBe(false);
    expect(isTextLikeBuffer(Buffer.from([0xff, 0xfe, 0xfd]))).toBe(false);
  });
});

describe("baselineDiffTextForEntry", () => {
  it("produces a git-style patch for a modified file", () => {
    const rel = "sub/a.ts";
    writeFileSync(join(work, rel), "line1\nline2\n", "utf8");
    const res = baselineDiffTextForEntry(
      rel,
      { kind: "file", bytes: Buffer.from("line1\nold2\n", "utf8") },
      work,
    );
    expect("diffText" in res).toBe(true);
    if (!("diffText" in res)) return;
    const text = res.diffText;
    expect(text.startsWith(`diff --git a/${rel} b/${rel}`)).toBe(true);
    expect(text).toContain("@@");
    expect(text).toContain("-old2");
    expect(text).toContain("+line2");
    expect(text).toContain(" line1");
    // 无 jsdiff 横幅 / 行尾 tab
    expect(text).not.toContain("=====");
    expect(text).not.toContain("--- sub/a.ts\t");
  });

  it("handles file creation (absent baseline → content)", () => {
    const rel = "new-file.ts";
    writeFileSync(join(work, rel), "a\nb\nc\n", "utf8");
    const res = baselineDiffTextForEntry(rel, { kind: "absent" }, work);
    expect("diffText" in res).toBe(true);
    if (!("diffText" in res)) return;
    expect(res.diffText).toContain("@@ -0,0 +1,3 @@");
    expect(res.diffText).toContain("+a");
  });

  it("handles deletion (file baseline → absent)", () => {
    const rel = "gone.ts";
    const res = baselineDiffTextForEntry(
      rel,
      { kind: "file", bytes: Buffer.from("x\ny\n", "utf8") },
      work,
    );
    expect("diffText" in res).toBe(true);
    if (!("diffText" in res)) return;
    expect(res.diffText).toContain("@@ -1,2 +0,0 @@");
    expect(res.diffText).toContain("-x");
  });

  it("returns unchanged when baseline matches disk", () => {
    const rel = "same.ts";
    writeFileSync(join(work, rel), "same\n", "utf8");
    const res = baselineDiffTextForEntry(
      rel,
      { kind: "file", bytes: Buffer.from("same\n", "utf8") },
      work,
    );
    expect(res).toEqual({ skipped: "unchanged" });
  });

  it("returns unchanged when absent and still absent", () => {
    const res = baselineDiffTextForEntry("never-existed.ts", { kind: "absent" }, work);
    expect(res).toEqual({ skipped: "unchanged" });
  });

  it("skips binary and oversized files", () => {
    const bin = baselineDiffTextForEntry(
      "bin.dat",
      { kind: "file", bytes: Buffer.from([0x00, 0x01, 0x02]) },
      work,
    );
    expect(bin).toEqual({ skipped: "binary" });

    const big = Buffer.alloc(MAX_DIFF_FILE_BYTES + 1, 0x61);
    const tooLarge = baselineDiffTextForEntry("big.ts", { kind: "file", bytes: big }, work);
    expect(tooLarge).toEqual({ skipped: "too_large" });
  });

  it("skips symlink baselines", () => {
    const res = baselineDiffTextForEntry(
      "link.ts",
      { kind: "symlink", target: "target.ts" },
      work,
    );
    expect(res).toEqual({ skipped: "binary" });
  });
});

describe("joinBaselineDiffs", () => {
  it("joins multiple files and truncates at the byte cap (line-aligned)", () => {
    const parts = [
      { rel: "a.ts", diffText: "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new\n" },
      { rel: "b.ts", diffText: "diff --git a/b.ts b/b.ts\n@@ -1 +1 @@\n-old2\n+new2\n" },
    ];
    const joined = joinBaselineDiffs(parts, 60);
    expect(joined.truncated).toBe(true);
    expect(joined.diffText).toContain("diff --git a/a.ts");
    // 截断不切行
    const tail = joined.diffText.split("\n").pop()!;
    expect(["old", "new", "@@ -1 +1 @@", "old2", "new2", ""]).toContain(tail);
    expect(Buffer.byteLength(joined.diffText, "utf8")).toBeLessThanOrEqual(400);

    const small = joinBaselineDiffs(parts);
    expect(small.truncated).toBeUndefined();
    expect(small.diffText).toContain("diff --git a/b.ts");
  });

  it("returns empty text for no parts", () => {
    expect(joinBaselineDiffs([])).toEqual({ diffText: "" });
  });
});
