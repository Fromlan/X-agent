/**
 * Vitest 套件 —— 覆盖 ROADMAP 1.1 首批关键模块迁移：retract-orchestrator。
 *
 * 通过 mock `RetractOrchestratorHost`（fileTracker / shadowCheckpoints / session）
 * 验证撤回编排的时序契约：abort → scan → navigate → restore → emit，无需真实 Pi 会话。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  RetractOrchestrator,
  resolveUserEntryId,
  type RetractOrchestratorHost,
  type RetractSessionBundle,
} from "./retract-orchestrator";

type SessionManager = {
  getEntry: (id: string) => unknown;
  getBranch: () => Array<{ type: string; id: string }>;
  getEntries: () => unknown[];
  appendCustomEntry: () => string;
};

function makeUserMessageEntry(id: string, text: string) {
  return { type: "message", id, message: { role: "user", content: [{ type: "text", text }] } };
}

/** 组装一份可配置的 RetractOrchestratorHost mock。 */
function makeHost(overrides?: {
  bundle?: RetractSessionBundle | null;
  streaming?: boolean;
  navCancelled?: boolean;
  shadowRestore?: "shadow" | "none";
  promptOk?: boolean;
  promptPreparing?: boolean;
}) {
  const scanSegment = {
    mutationPaths: ["a.txt"],
    userEntryIds: ["u1"],
    hasBash: false,
    hasGodot: false,
  };
  const fileTracker = {
    kind: "baseline" as const,
    label: "write/edit 基线",
    fallbackWarning: "write/edit 基线还原失败。",
    scanSegmentSince: vi.fn(() => scanSegment),
    preview: vi.fn(async () => ({
      mode: "baseline" as const,
      restorablePaths: ["a.txt"],
      unrestorablePaths: [],
      hasBash: false,
      hasGodot: false,
      warnings: [],
    })),
    restore: vi.fn(async () => ({
      used: "baseline" as const,
      report: {
        restored: ["a.txt"],
        deleted: [],
        skipped: [],
        warnings: [],
      },
    })),
    dropBaselinesForTurns: vi.fn(),
    persistDirty: vi.fn(),
    setActiveUserEntryId: vi.fn(),
  };
  const shadowCheckpoints = {
    kind: "shadow" as const,
    label: "Shadow 检查点",
    fallbackWarning: "Shadow 检查点还原失败，已降级为 write/edit 基线。",
    enabledShadow: false,
    preview: vi.fn(async () => ({
      mode: "baseline" as const,
      restorablePaths: [],
      unrestorablePaths: [],
      hasBash: false,
      hasGodot: false,
      warnings: [],
    })),
    restore: vi.fn(async () => ({
      used: (overrides?.shadowRestore ?? "none") as "shadow" | "none",
      report: {
        restored: ["a.txt"],
        deleted: [],
        skipped: [],
        warnings: [],
      },
    })),
    discardPendingPre: vi.fn(),
    pruneAbandonedTurns: vi.fn(),
    persistDirty: vi.fn(),
  };

  const session = {
    isStreaming: overrides?.streaming ?? false,
    abort: vi.fn(async () => {}),
    navigateTree: vi.fn(async () => ({
      cancelled: overrides?.navCancelled ?? false,
      editorText: "hello",
    })),
    sessionManager: {
      getEntry: (id: string) => makeUserMessageEntry(id, "hello"),
      getBranch: () => [{ type: "message", id: "u0" }],
      getEntries: () => [],
      appendCustomEntry: () => "c",
    },
  };

  const bundle: RetractSessionBundle = {
    session: session as unknown as RetractSessionBundle["session"],
  };

  const setStatus = vi.fn();
  const pruneToolDetailsToBranch = vi.fn();
  const emitHistoryReplace = vi.fn();
  const emitUsageUpdate = vi.fn();
  const prompt = vi.fn(async () => ({ ok: overrides?.promptOk ?? true }));
  const onRetractSuccess = vi.fn();

  let currentBundle: RetractSessionBundle | null =
    overrides?.bundle === null ? null : bundle;

  const host: RetractOrchestratorHost = {
    getBundle: () => currentBundle,
    fileTracker: fileTracker as never,
    shadowCheckpoints: shadowCheckpoints as never,
    setStatus,
    pruneToolDetailsToBranch,
    emitHistoryReplace,
    emitUsageUpdate,
    prompt,
    isPromptPreparing: () => overrides?.promptPreparing ?? false,
    onRetractSuccess,
  };

  return {
    host,
    session,
    fileTracker,
    shadowCheckpoints,
    setStatus,
    pruneToolDetailsToBranch,
    emitHistoryReplace,
    emitUsageUpdate,
    prompt,
    onRetractSuccess,
    setBundle: (b: RetractSessionBundle | null) => {
      currentBundle = b;
    },
  };
}

function makeOrchestrator(host: RetractOrchestratorHost): RetractOrchestrator {
  return new RetractOrchestrator(() => host);
}

describe("resolveUserEntryId（纯函数）", () => {
  const bundle: RetractSessionBundle = {
    session: {
      sessionManager: {
        getEntry: (id: string) =>
          id === "u1" ? makeUserMessageEntry("u1", "hello") : undefined,
      },
    } as never,
  };

  it("无 bundle 返回错误", () => {
    expect(resolveUserEntryId(null, "u1").ok).toBe(false);
  });

  it("找不到消息返回错误", () => {
    const r = resolveUserEntryId(bundle, "nope");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("找不到");
  });

  it("非用户消息返回错误", () => {
    const b: RetractSessionBundle = {
      session: {
        sessionManager: {
          getEntry: () => ({ type: "message", id: "u1", message: { role: "assistant" } }),
        },
      } as never,
    };
    expect(resolveUserEntryId(b, "u1").ok).toBe(false);
  });

  it("空文本用户消息返回错误", () => {
    const b: RetractSessionBundle = {
      session: {
        sessionManager: {
          getEntry: () => ({ type: "message", id: "u1", message: { role: "user", content: [] } }),
        },
      } as never,
    };
    const r = resolveUserEntryId(b, "u1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("为空");
  });

  it("合法用户消息返回 editorText", () => {
    const r = resolveUserEntryId(bundle, "u1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entryId).toBe("u1");
      expect(r.editorText).toBe("hello");
    }
  });
});

describe("RetractOrchestrator.preview", () => {
  it("无项目时返回错误", async () => {
    const ctx = makeHost({ bundle: null });
    const orch = makeOrchestrator(ctx.host);
    const res = await orch.preview("u1");
    expect(res.ok).toBe(false);
  });

  it("Shadow 可用时走 shadow preview", async () => {
    const ctx = makeHost();
    ctx.shadowCheckpoints.enabledShadow = true;
    ctx.shadowCheckpoints.preview.mockResolvedValue({
      mode: "shadow",
      restorablePaths: ["a.txt", "b.txt"],
      unrestorablePaths: [],
      hasBash: true,
      hasGodot: false,
      warnings: [],
    });
    const orch = makeOrchestrator(ctx.host);
    const res = await orch.preview("u1");
    expect(res.ok).toBe(true);
    expect(res.restoreMode).toBe("shadow");
    expect(res.restorablePaths).toEqual(["a.txt", "b.txt"]);
    expect(ctx.fileTracker.scanSegmentSince).toHaveBeenCalled();
  });

  it("无 Shadow 时走 fileTracker baseline", async () => {
    const ctx = makeHost();
    const orch = makeOrchestrator(ctx.host);
    const res = await orch.preview("u1");
    expect(res.ok).toBe(true);
    expect(res.restoreMode).toBe("baseline");
    expect(ctx.shadowCheckpoints.preview).toHaveBeenCalled();
    expect(ctx.fileTracker.preview).toHaveBeenCalled();
  });
});

describe("RetractOrchestrator.retract", () => {
  it("无项目时返回错误", async () => {
    const ctx = makeHost({ bundle: null });
    const orch = makeOrchestrator(ctx.host);
    expect((await orch.retract("u1")).ok).toBe(false);
  });

  it("prompt 准备窗口内拒绝撤回（竞态硬闸）", async () => {
    const ctx = makeHost({ promptPreparing: true });
    const orch = makeOrchestrator(ctx.host);
    const res = await orch.retract("u1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("发送中");
    expect(ctx.session.navigateTree).not.toHaveBeenCalled();
    expect(ctx.shadowCheckpoints.restore).not.toHaveBeenCalled();
  });

  it("成功路径丢弃未绑定的 pending pre SHA", async () => {
    const ctx = makeHost();
    const orch = makeOrchestrator(ctx.host);
    await orch.retract("u1");
    expect(ctx.shadowCheckpoints.discardPendingPre).toHaveBeenCalled();
  });

  it("流式时先 abort 再走流程", async () => {
    const ctx = makeHost({ streaming: true });
    const orch = makeOrchestrator(ctx.host);
    const res = await orch.retract("u1");
    expect(ctx.session.abort).toHaveBeenCalled();
    expect(ctx.setStatus).toHaveBeenCalledWith("idle");
    expect(res.ok).toBe(true);
  });

  it("navigate 被取消时返回错误", async () => {
    const ctx = makeHost({ navCancelled: true });
    const orch = makeOrchestrator(ctx.host);
    const res = await orch.retract("u1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("取消");
  });

  it("Shadow restore 成功时使用 shadow report", async () => {
    const ctx = makeHost({ shadowRestore: "shadow" });
    const orch = makeOrchestrator(ctx.host);
    const res = await orch.retract("u1");
    expect(res.ok).toBe(true);
    expect(ctx.shadowCheckpoints.restore).toHaveBeenCalled();
    expect(ctx.fileTracker.restore).not.toHaveBeenCalled();
    expect(res.restoreReport?.restored).toContain("a.txt");
  });

  it("undoFiles=false 时跳过文件还原", async () => {
    const ctx = makeHost();
    const orch = makeOrchestrator(ctx.host);
    const res = await orch.retract("u1", { undoFiles: false });
    expect(res.ok).toBe(true);
    expect(ctx.shadowCheckpoints.restore).not.toHaveBeenCalled();
    expect(ctx.fileTracker.restore).not.toHaveBeenCalled();
  });

  it("B10: undoFiles=false 仍清理基线/检查点元数据", async () => {
    const ctx = makeHost();
    const orch = makeOrchestrator(ctx.host);
    const res = await orch.retract("u1", { undoFiles: false });
    expect(res.ok).toBe(true);
    expect(ctx.fileTracker.dropBaselinesForTurns).toHaveBeenCalledWith(["u1"]);
    expect(ctx.fileTracker.persistDirty).toHaveBeenCalled();
    expect(ctx.shadowCheckpoints.pruneAbandonedTurns).toHaveBeenCalledWith(
      "u1",
      ["u1"],
    );
    expect(ctx.shadowCheckpoints.persistDirty).toHaveBeenCalled();
  });

  it("成功路径触发历史替换与状态清理", async () => {
    const ctx = makeHost();
    const orch = makeOrchestrator(ctx.host);
    await orch.retract("u1");
    expect(ctx.pruneToolDetailsToBranch).toHaveBeenCalled();
    expect(ctx.emitHistoryReplace).toHaveBeenCalled();
    expect(ctx.emitUsageUpdate).toHaveBeenCalled();
    expect(ctx.fileTracker.setActiveUserEntryId).toHaveBeenCalledWith(null);
    expect(ctx.onRetractSuccess).toHaveBeenCalledWith(["u1"]);
  });
});

describe("RetractOrchestrator.editAndResend / regenerate", () => {
  it("editAndResend 空文本报错", async () => {
    const ctx = makeHost();
    const orch = makeOrchestrator(ctx.host);
    const res = await orch.editAndResend("u1", "   ");
    expect(res.ok).toBe(false);
  });

  it("editAndResend 撤回成功后重新 prompt", async () => {
    const ctx = makeHost({ promptOk: true });
    const orch = makeOrchestrator(ctx.host);
    const res = await orch.editAndResend("u1", "重写这段");
    expect(res.ok).toBe(true);
    expect(ctx.prompt).toHaveBeenCalledWith("重写这段");
  });

  it("regenerate 撤回后以原文本重发", async () => {
    const ctx = makeHost({ promptOk: true });
    const orch = makeOrchestrator(ctx.host);
    const res = await orch.regenerate("u1");
    expect(res.ok).toBe(true);
    expect(ctx.prompt).toHaveBeenCalledWith("hello");
  });
});
