/**
 * TurnFileTracker 无 Git 降级 diff 相关单测（node 环境，不需要 git）。
 * 覆盖：diffTextForTurn 产出基线 diff / 无基线返回 null /
 * previewRestore 附带 diffText / getTurnBaselines 按 turn 隔离。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TurnFileTracker } from "./turn-file-tracker";

let work = "";
let tracker: TurnFileTracker;

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "x-agent-tracker-diff-"));
  mkdirSync(join(work, "sub"), { recursive: true });
});

afterAll(() => {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function freshTracker(): TurnFileTracker {
  const t = new TurnFileTracker();
  t.setCwd(work);
  t.setActiveUserEntryId("u1");
  return t;
}

describe("diffTextForTurn", () => {
  it("产出修改 / 新增文件的基线 diff", () => {
    tracker = freshTracker();
    writeFileSync(join(work, "a.txt"), "before1\nbefore2\n", "utf8");
    tracker.captureBeforeTool("write", { path: "a.txt" });
    writeFileSync(join(work, "a.txt"), "after1\nafter2\n", "utf8");
    // b.txt 尚不存在 → absent 基线；随后被创建
    tracker.captureBeforeTool("write", { path: "b.txt" });
    writeFileSync(join(work, "b.txt"), "created\n", "utf8");

    const diff = tracker.diffTextForTurn("u1");
    expect(diff).not.toBeNull();
    expect(diff!.paths.sort()).toEqual(["a.txt", "b.txt"]);
    expect(diff!.diffText).toContain("diff --git a/a.txt b/a.txt");
    expect(diff!.diffText).toContain("-before1");
    expect(diff!.diffText).toContain("+after1");
    expect(diff!.diffText).toContain("diff --git a/b.txt b/b.txt");
    expect(diff!.truncated).toBeUndefined();
  });

  it("无基线或内容未变时返回 null", () => {
    tracker = freshTracker();
    expect(tracker.diffTextForTurn("u-ghost")).toBeNull();

    writeFileSync(join(work, "same.txt"), "same\n", "utf8");
    tracker.captureBeforeTool("edit", { file_path: "same.txt" });
    expect(tracker.diffTextForTurn("u1")).toBeNull();
  });

  it("非 write/edit 工具不记录基线", () => {
    tracker = freshTracker();
    tracker.captureBeforeTool("bash", { command: "echo hi" });
    expect(tracker.diffTextForTurn("u1")).toBeNull();
  });
});

describe("previewRestore（baseline 模式）", () => {
  it("附带 write/edit 基线 diffText（无 git 降级路径）", () => {
    tracker = freshTracker();
    writeFileSync(join(work, "a.txt"), "v1\n", "utf8");
    tracker.captureBeforeTool("write", { path: "a.txt" });
    writeFileSync(join(work, "a.txt"), "v2\n", "utf8");

    const sm = {
      getBranch: () => [
        { type: "message", id: "u1", message: { role: "user", content: [] } },
        {
          type: "message",
          id: "a1",
          message: {
            role: "assistant",
            content: [
              { type: "toolCall", name: "write", arguments: { path: "a.txt" } },
            ],
          },
        },
      ],
      getEntries: () => [],
      getEntry: () => undefined,
      appendCustomEntry: () => "c",
    };
    const p = tracker.previewRestore(sm as never, "u1");
    expect(p.restorablePaths).toEqual(["a.txt"]);
    expect(p.diffText).toBeTruthy();
    expect(p.diffText!.includes("-v1")).toBe(true);
    expect(p.diffText!.includes("+v2")).toBe(true);
    expect(p.diffTruncated).toBeUndefined();
  });
});

describe("getTurnBaselines", () => {
  it("按 userEntryId 隔离基线", () => {
    tracker = freshTracker();
    writeFileSync(join(work, "x.txt"), "x\n", "utf8");
    tracker.captureBeforeTool("write", { path: "x.txt" });
    tracker.setActiveUserEntryId("u2");
    writeFileSync(join(work, "y.txt"), "y\n", "utf8");
    tracker.captureBeforeTool("write", { path: "y.txt" });

    expect(tracker.getTurnBaselines("u1").map((b) => b.rel)).toEqual(["x.txt"]);
    expect(tracker.getTurnBaselines("u2").map((b) => b.rel)).toEqual(["y.txt"]);
    expect(tracker.getTurnBaselines("u0")).toEqual([]);
  });
});
