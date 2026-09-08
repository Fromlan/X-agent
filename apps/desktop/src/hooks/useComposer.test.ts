/**
 * Vitest 套件 —— src/hooks/useComposer (issue #61 主题 F C-205).
 *
 * 锁住 5 组不变量:
 * 1. `hasSendableContent` 闸门 (text / image / file 任一非空)
 * 2. `buildImageUnsupportedMessage` 错误文案 + null
 * 3. `createComposerDispatcher` 行为:
 *    - send 闸门 / 图片能力闸门
 *    - send 主体: pending bubble → expandAtPaths → turn.prompt → 失败撤回
 *    - /goal 命令走注入的 goal dispatcher
 *    - abort / addFiles / removeImage / removeFile
 *    - onClarifySelect
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ImageContent, ModelInfo } from "@shared/ipc";
import type { FileReference } from "../lib/file-attachment";
import {
  buildImageUnsupportedMessage,
  createComposerDispatcher,
  hasSendableContent,
} from "./useComposer";

// ─── hasSendableContent (纯函数) ───────────────────────────────────────

describe("hasSendableContent —— 纯函数闸门", () => {
  it("纯空白 input + 无 attachment + 无 file → false", () => {
    expect(hasSendableContent("", [], [])).toBe(false);
    expect(hasSendableContent("   ", [], [])).toBe(false);
    expect(hasSendableContent("\n\t", [], [])).toBe(false);
  });

  it("有 text → true", () => {
    expect(hasSendableContent("hello", [], [])).toBe(true);
    expect(hasSendableContent("  hello  ", [], [])).toBe(true);
  });

  it("有 image → true (纯图也能发, #42)", () => {
    const img: ImageContent = {
      type: "image",
      data: "x",
      mimeType: "image/png",
    };
    expect(hasSendableContent("", [img], [])).toBe(true);
  });

  it("有 file ref → true (纯文件也能发)", () => {
    const ref: FileReference = {
      absPath: "/tmp/data.csv",
      displayName: "data.csv",
    };
    expect(hasSendableContent("", [], [ref])).toBe(true);
  });
});

// ─── buildImageUnsupportedMessage (纯函数) ─────────────────────────────

describe("buildImageUnsupportedMessage —— 模型能力闸门", () => {
  const models: ModelInfo[] = [
    {
      provider: "anthropic",
      id: "claude-sonnet-4-5",
      name: "anthropic/claude-sonnet-4-5",
      input: ["text", "image"],
    },
    {
      provider: "mistral",
      id: "mistral-large-2411",
      name: "mistral/mistral-large-2411",
      input: ["text"],
    },
  ];

  it("vision 模型 → null (不挡)", () => {
    expect(buildImageUnsupportedMessage(models, "anthropic/claude-sonnet-4-5")).toBeNull();
  });

  it("非 vision 模型 → 报错 + 含模型名 + 含 vision 例子", () => {
    const msg = buildImageUnsupportedMessage(models, "mistral/mistral-large-2411");
    expect(msg).not.toBeNull();
    expect(msg).toContain("mistral/mistral-large-2411");
    expect(msg).toContain("vision");
  });

  it("未知 model key → 报错 (保守)", () => {
    expect(buildImageUnsupportedMessage(models, "openai/gpt-4o-not-in-list")).not.toBeNull();
  });

  it("空 / null model key → 报错", () => {
    expect(buildImageUnsupportedMessage(models, "")).not.toBeNull();
    expect(buildImageUnsupportedMessage(models, null as unknown as string)).not.toBeNull();
  });
});

// ─── createComposerDispatcher ──────────────────────────────────────────

type PlanMock = {
  getGoal: ReturnType<typeof vi.fn>;
  setGoal: ReturnType<typeof vi.fn>;
  clearGoal: ReturnType<typeof vi.fn>;
  pauseGoal: ReturnType<typeof vi.fn>;
  resumeGoal: ReturnType<typeof vi.fn>;
  setMode: ReturnType<typeof vi.fn>;
};
type TurnMock = {
  prompt: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
};

function installIpcMock() {
  const planMock: PlanMock = {
    getGoal: vi.fn().mockResolvedValue(null),
    setGoal: vi.fn().mockResolvedValue({ ok: true, goal: null }),
    clearGoal: vi.fn().mockResolvedValue({ ok: true }),
    pauseGoal: vi.fn().mockResolvedValue({ ok: true, goal: null }),
    resumeGoal: vi.fn().mockResolvedValue({ ok: true, goal: null }),
    setMode: vi.fn().mockResolvedValue({
      ok: true,
      info: { mode: "agent", planPath: null, needGoalCondition: false },
    }),
  };
  const turnMock: TurnMock = {
    prompt: vi.fn().mockResolvedValue({ ok: true, silent: false }),
    abort: vi.fn().mockResolvedValue({ ok: true }),
  };
  (globalThis as unknown as {
    window: {
      xAgent: { plan: PlanMock; turn: TurnMock };
      xAgentPath?: { getForFile: (f: File) => string };
    };
  }).window = {
    xAgent: { plan: planMock, turn: turnMock },
    xAgentPath: { getForFile: (f: File) => (f as unknown as { path?: string }).path ?? "" },
  };
  return { planMock, turnMock };
}

function setupSetters() {
  const setInput = vi.fn();
  const setAttachments = vi.fn();
  const setFileRefs = vi.fn();
  const setError = vi.fn();
  const setFollowNonce = vi.fn();
  const setItems = vi.fn();
  const goalDispatcher = {
    handleGoalCommand: vi.fn().mockResolvedValue(false),
  };
  const refreshSessions = vi.fn().mockResolvedValue(undefined);
  return {
    setInput,
    setAttachments,
    setFileRefs,
    setError,
    setFollowNonce,
    setItems,
    goalDispatcher,
    refreshSessions,
  };
}

function makeDispatcher(
  overrides: Partial<Parameters<typeof createComposerDispatcher>[0]> = {},
) {
  const setters = setupSetters();
  const d = createComposerDispatcher({
    cwd: "/tmp/proj",
    models: [],
    currentModelKey: "",
    input: "hello world",
    attachments: [],
    fileRefs: [],
    status: "idle",
    sessionMode: "agent",
    goal: null as never,
    ...setters,
    ...overrides,
  });
  return { d, setters };
}

describe("createComposerDispatcher —— 行为契约 (useComposer 通过它实现)", () => {
  beforeEach(() => {
    installIpcMock();
  });

  it("send: 无内容 + 无 cwd → false, 不调 IPC", async () => {
    const { d, setters } = makeDispatcher({
      cwd: null,
      input: "",
      attachments: [],
      fileRefs: [],
    });
    const ok = await d.send();
    expect(ok).toBe(false);
    expect(setters.setError).not.toHaveBeenCalled();
    expect(setters.setItems).not.toHaveBeenCalled();
  });

  it("send: 有内容 + 无 cwd → false, 不调 IPC", async () => {
    const { d } = makeDispatcher({ cwd: null, input: "hello" });
    const ok = await d.send();
    expect(ok).toBe(false);
  });

  it("send: input 走 setInput(\"\") + setAttachments([]) + setFileRefs([]) + 清错 + bump followNonce", async () => {
    const { d, setters } = makeDispatcher();
    await d.send();
    expect(setters.setInput).toHaveBeenCalledWith("");
    expect(setters.setAttachments).toHaveBeenCalledWith([]);
    expect(setters.setFileRefs).toHaveBeenCalledWith([]);
    expect(setters.setError).toHaveBeenCalledWith(null);
    expect(setters.setFollowNonce).toHaveBeenCalled();
  });

  it("send: /goal 命令 → 走 goalDispatcher, 不直接调 turn.prompt", async () => {
    const { d, setters } = makeDispatcher({ input: "/goal clear" });
    setters.goalDispatcher.handleGoalCommand.mockResolvedValue(true);
    const ok = await d.send();
    expect(ok).toBe(true);
    expect(setters.goalDispatcher.handleGoalCommand).toHaveBeenCalledWith("/goal clear");
    expect(setters.setItems).not.toHaveBeenCalled();
  });

  it("send: 正常 message → append pending user bubble + turn.prompt", async () => {
    const { turnMock } = installIpcMock();
    const { d, setters } = makeDispatcher({ input: "hello" });
    await d.send();
    expect(setters.setItems).toHaveBeenCalled();
    expect(turnMock.prompt).toHaveBeenCalled();
    // 调用过 refreshSessions
    expect(setters.refreshSessions).toHaveBeenCalled();
  });

  it("send: turn.prompt !ok → 撤回 pending bubble + setError", async () => {
    const { turnMock } = installIpcMock();
    turnMock.prompt.mockResolvedValue({ ok: false, silent: false, error: "网络断了" });
    const { d, setters } = makeDispatcher();
    await d.send();
    // setItems 应被调 2 次: append + remove
    expect(setters.setItems).toHaveBeenCalledTimes(2);
    expect(setters.setError).toHaveBeenCalledWith("网络断了");
    expect(turnMock.prompt).toHaveBeenCalled();
  });

  it("send: turn.prompt silent → 撤回 pending bubble, 不 setError", async () => {
    const { turnMock } = installIpcMock();
    turnMock.prompt.mockResolvedValue({ ok: true, silent: true });
    const { d, setters } = makeDispatcher();
    await d.send();
    expect(setters.setItems).toHaveBeenCalledTimes(2);
    expect(setters.setError).not.toHaveBeenCalledWith(expect.stringMatching(/失败/));
  });

  it("send: 图片 + 不收图模型 → setError 报错 + 不发, 不调 setItems", async () => {
    const models: ModelInfo[] = [
      {
        provider: "mistral",
        id: "mistral-large",
        name: "mistral/mistral-large",
        input: ["text"],
      },
    ];
    const img: ImageContent = {
      type: "image",
      data: "x",
      mimeType: "image/png",
    };
    const { d, setters } = makeDispatcher({
      models,
      currentModelKey: "mistral/mistral-large",
      attachments: [img],
      input: "",
    });
    const ok = await d.send();
    expect(ok).toBe(false);
    expect(setters.setError).toHaveBeenCalled();
    expect(setters.setItems).not.toHaveBeenCalled();
  });

  it("abort: 调 window.xAgent.turn.abort", async () => {
    const { turnMock } = installIpcMock();
    const { d } = makeDispatcher();
    await d.abort();
    expect(turnMock.abort).toHaveBeenCalled();
  });

  it("abort: 抛错时不冒泡 (UI 静默吞掉, dbgLog)", async () => {
    const { turnMock } = installIpcMock();
    const { d } = makeDispatcher();
    turnMock.abort.mockRejectedValue(new Error("boom"));
    await expect(d.abort()).resolves.toBeUndefined();
  });

  it("onAddFiles: 0 文件 → no-op", async () => {
    const { d, setters } = makeDispatcher();
    await d.onAddFiles([]);
    expect(setters.setAttachments).not.toHaveBeenCalled();
    expect(setters.setFileRefs).not.toHaveBeenCalled();
  });

  it("onRemoveImage: 按 index 过滤", () => {
    const { d, setters } = makeDispatcher();
    const imgs: ImageContent[] = [
      { type: "image", data: "a", mimeType: "image/png" },
      { type: "image", data: "b", mimeType: "image/png" },
    ];
    d.onRemoveImage(0);
    expect(setters.setAttachments).toHaveBeenCalled();
    const fn = setters.setAttachments.mock.calls[0]![0] as (
      prev: ImageContent[],
    ) => ImageContent[];
    expect(fn(imgs)).toEqual([imgs[1]]);
  });

  it("onRemoveFile: 按 index 过滤", () => {
    const { d, setters } = makeDispatcher();
    const refs: FileReference[] = [
      { absPath: "/a", displayName: "a" },
      { absPath: "/b", displayName: "b" },
    ];
    d.onRemoveFile(1);
    const fn = setters.setFileRefs.mock.calls[0]![0] as (
      prev: FileReference[],
    ) => FileReference[];
    expect(fn(refs)).toEqual([refs[0]]);
  });

  it("onClarifySelect: 无 cwd / 空 reply → no-op", async () => {
    const { d, setters } = makeDispatcher();
    await d.onClarifySelect("");
    expect(setters.setItems).not.toHaveBeenCalled();
    await d.onClarifySelect("  ");
    expect(setters.setItems).not.toHaveBeenCalled();
  });

  it("onClarifySelect: 正常 → append + turn.prompt + refreshSessions", async () => {
    const { d, setters } = makeDispatcher();
    await d.onClarifySelect("选 A");
    expect(setters.setItems).toHaveBeenCalled();
    expect(setters.refreshSessions).toHaveBeenCalled();
  });

  it("onClarifySelect: 失败时 setError + 还原 input", async () => {
    const { turnMock } = installIpcMock();
    turnMock.prompt.mockResolvedValue({ ok: false, silent: false, error: "boom" });
    const { d, setters } = makeDispatcher();
    await d.onClarifySelect("选 A");
    expect(setters.setError).toHaveBeenCalledWith("boom");
    expect(setters.setInput).toHaveBeenCalledWith("选 A");
  });

  it("canSend: 有内容 + cwd → true", () => {
    const { d } = makeDispatcher({ cwd: "/p", input: "hi" });
    expect(d.canSend()).toBe(true);
  });

  it("canSend: 无 cwd → false", () => {
    const { d } = makeDispatcher({ cwd: null, input: "hi" });
    expect(d.canSend()).toBe(false);
  });

  it("canSend: 纯图片 + cwd → true (与 #42 一致)", () => {
    const img: ImageContent = {
      type: "image",
      data: "x",
      mimeType: "image/png",
    };
    const { d } = makeDispatcher({ cwd: "/p", input: "", attachments: [img] });
    expect(d.canSend()).toBe(true);
  });
});
