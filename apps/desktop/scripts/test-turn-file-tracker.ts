import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FILE_BASELINE_CUSTOM_TYPE,
  TurnFileTracker,
  pathFromArgsForTest,
} from "../electron/agent/turn-file-tracker";

const root = mkdtempSync(join(tmpdir(), "x-agent-file-tracker-"));

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

try {
  assert(pathFromArgsForTest({ path: "a.ts" }) === "a.ts", "path key");
  assert(pathFromArgsForTest({ file_path: "b.ts" }) === "b.ts", "file_path key");
  assert(pathFromArgsForTest({ filePath: "c.ts" }) === "c.ts", "filePath key");
  assert(pathFromArgsForTest({ file: "d.ts" }) === "d.ts", "file key");
  assert(
    pathFromArgsForTest({ notebook_path: "e.ipynb" }) === "e.ipynb",
    "notebook_path key",
  );
  assert(pathFromArgsForTest({ uri: "f.ts" }) === "f.ts", "uri key");
  assert(pathFromArgsForTest({ dst: "g.ts" }) === "g.ts", "dst key");
  assert(pathFromArgsForTest({ target: "h.ts" }) === "h.ts", "target key");
  assert(pathFromArgsForTest({}) === null, "empty args");

  const tracker = new TurnFileTracker();
  tracker.setCwd(root);
  tracker.setActiveUserEntryId("u1");

  const existing = join(root, "existing.txt");
  writeFileSync(existing, "v1", "utf8");

  tracker.captureBeforeTool("write", { path: "existing.txt" });
  tracker.captureBeforeTool("write", { path: "new.txt" });
  writeFileSync(existing, "v2", "utf8");
  tracker.captureBeforeTool("write", { path: "existing.txt" });

  writeFileSync(existing, "mutated", "utf8");
  writeFileSync(join(root, "new.txt"), "created", "utf8");

  let persisted: unknown = null;

  const sm = {
    getBranch: () => [
      {
        type: "message",
        id: "u1",
        message: {
          role: "user",
          content: [{ type: "text", text: "edit files" }],
        },
      },
      {
        type: "message",
        id: "a1",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "t1",
              name: "write",
              arguments: { path: "existing.txt" },
            },
            {
              type: "toolCall",
              id: "t2",
              name: "write",
              arguments: { path: "new.txt" },
            },
            {
              type: "toolCall",
              id: "t3",
              name: "bash",
              arguments: { command: "echo hi" },
            },
          ],
        },
      },
    ],
    getEntries: () =>
      [] as Array<{
        type: string;
        id: string;
        customType?: string;
        data?: unknown;
      }>,
    getEntry: () => undefined,
    appendCustomEntry: (customType: string, data?: unknown) => {
      assert(customType === FILE_BASELINE_CUSTOM_TYPE, "custom type");
      persisted = data;
      return "custom-1";
    },
  };

  const preview = tracker.previewRestore(sm, "u1");
  assert(preview.hasBash, "hasBash");
  assert(preview.restorablePaths.includes("existing.txt"), "restorable existing");
  assert(preview.restorablePaths.includes("new.txt"), "restorable new");

  const report = tracker.restoreSince(sm, "u1");
  assert(report.restored.includes("existing.txt"), "restored existing");
  assert(report.deleted.includes("new.txt"), "deleted new");
  assert(readFileSync(existing, "utf8") === "v1", "existing rolled back");
  assert(!existsSync(join(root, "new.txt")), "new removed");
  assert(
    report.skipped.some((s) => s.reason === "bash_unknown"),
    "bash skipped",
  );

  tracker.setActiveUserEntryId("u1");
  tracker.captureBeforeTool("edit", { path: "../escape.txt" });
  assert(!tracker.hasBaseline("../escape.txt", "u1"), "reject escape");

  // Re-capture after restore for persist test
  writeFileSync(existing, "v1", "utf8");
  tracker.setActiveUserEntryId("u1");
  tracker.captureBeforeTool("write", { path: "existing.txt" });
  tracker.persistDirty(sm);
  assert(persisted && typeof persisted === "object", "persisted");
  assert(
    (persisted as { turns?: Record<string, unknown> }).turns?.u1,
    "persisted turn",
  );

  const tracker2 = new TurnFileTracker();
  tracker2.setCwd(root);
  const sm2 = {
    ...sm,
    getEntries: () => [
      {
        type: "custom",
        id: "c1",
        customType: FILE_BASELINE_CUSTOM_TYPE,
        data: persisted,
      },
    ],
  };
  tracker2.loadFromSession(sm2);
  assert(tracker2.hasBaseline("existing.txt", "u1"), "loaded baseline");

  // Multi-turn: turn2 baseline should be post-turn1
  const multi = new TurnFileTracker();
  multi.setCwd(root);
  writeFileSync(existing, "base", "utf8");
  multi.setActiveUserEntryId("u1");
  multi.captureBeforeTool("write", { path: "existing.txt" });
  writeFileSync(existing, "after-t1", "utf8");
  multi.setActiveUserEntryId("u2");
  multi.captureBeforeTool("write", { path: "existing.txt" });
  writeFileSync(existing, "after-t2", "utf8");

  const smMulti = {
    getBranch: () => [
      {
        type: "message",
        id: "u1",
        message: { role: "user", content: [{ type: "text", text: "t1" }] },
      },
      {
        type: "message",
        id: "a1",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "t1",
              name: "write",
              arguments: { path: "existing.txt" },
            },
          ],
        },
      },
      {
        type: "message",
        id: "u2",
        message: { role: "user", content: [{ type: "text", text: "t2" }] },
      },
      {
        type: "message",
        id: "a2",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "t2",
              name: "write",
              arguments: { path: "existing.txt" },
            },
          ],
        },
      },
    ],
    getEntries: () => [],
    getEntry: () => undefined,
    appendCustomEntry: () => "x",
  };

  const r2 = multi.restoreSince(smMulti, "u2");
  assert(r2.restored.includes("existing.txt"), "t2 restored");
  assert(readFileSync(existing, "utf8") === "after-t1", "t2 rolls to after-t1");

  const empty = new TurnFileTracker();
  empty.setCwd(root);
  const miss = empty.restorePaths(["ghost.txt"], ["u1"]);
  assert(miss.skipped[0]?.reason === "no_baseline", "no baseline");

  // Fix B: setCwd 必须清空旧基线，避免污染新项目。
  const cwdSwap = new TurnFileTracker();
  cwdSwap.setCwd(root);
  cwdSwap.setActiveUserEntryId("u1");
  cwdSwap.captureBeforeTool("write", { path: "swap.txt" });
  assert(cwdSwap.hasBaseline("swap.txt", "u1"), "pre-swap baseline");
  cwdSwap.setCwd(root); // 同 cwd，setCwd 也会清空（行为合同：cwd 引用失效）
  cwdSwap.setActiveUserEntryId("u1");
  cwdSwap.captureBeforeTool("write", { path: "swap.txt" });
  assert(cwdSwap.hasBaseline("swap.txt", "u1"), "post-setCwd baseline");
  // 重新 setCwd 到一个不存在目录：resolveInsideCwd 会拒绝，capture 不会写
  cwdSwap.setCwd(join(root, "does-not-exist"));
  assert(!cwdSwap.hasBaseline("swap.txt", "u1"), "cleared on setCwd");

  // Fix E: symlink 基线单独存 target；还原时 re-create symlink。
  const linkTracker = new TurnFileTracker();
  linkTracker.setCwd(root);
  // 在 root 下创建初始 symlink 指向 temp 文件
  const targetAbs = join(root, "target.txt");
  writeFileSync(targetAbs, "payload", "utf8");
  const linkRel = "link.txt";
  const linkAbs = join(root, linkRel);
  try {
    symlinkSync(targetAbs, linkAbs);
  } catch {
    // Windows 在某些环境不允许 symlink；测试跳过
    console.log("turn-file-tracker ok (symlink skipped on this FS)");
    process.exit(0);
  }
  linkTracker.setActiveUserEntryId("u1");
  linkTracker.captureBeforeTool("write", { path: linkRel });
  // 模型"删除"了 symlink（替换为普通文件）
  unlinkSync(linkAbs);
  writeFileSync(linkAbs, "regular", "utf8");
  assert(!lstatSync(linkAbs).isSymbolicLink(), "link replaced");
  // 还原 → symlink 应被恢复
  const rep = linkTracker.restorePaths([linkRel], ["u1"]);
  assert(rep.restored.includes(linkRel), "symlink restored");
  assert(lstatSync(linkAbs).isSymbolicLink(), "is symlink again");

  console.log("turn-file-tracker ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}
