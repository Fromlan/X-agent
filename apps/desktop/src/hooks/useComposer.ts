/**
 * `useComposer` —— Issue #61 主题 F C-205 (2026-08-31).
 *
 * 把散在 App.tsx 的 composer 状态机 (input / attachments / fileRefs /
 * apiStatus / send / abort / onAddFiles / onClarifySelect) 收到一个
 * hook + 工厂里, 配合 useGoalMode 把 /goal 命令解析也一并外包。
 *
 * 拆两层:
 * 1. 纯函数 `hasSendableContent` (gate 闸), 单测目标。
 * 2. `createComposerDispatcher(deps)` 工厂 (主 send / abort / addFiles
 *    行为), 不依赖 React, 单测目标。
 * 3. `useComposer(opts)` 薄 React hook (state + dispatcher), App 用。
 *
 * 行为与原 App.tsx 100% 等价:
 * - /goal 解析走注入的 goal dispatcher (useGoalMode.createGoalModeDispatcher)
 * - 图片闸门走 modelSupportsImage (不收图 → 报错)
 * - send 失败 / silent 撤回 pending bubble, ok / fresh 走 refreshSessions
 * - apiStatus 用 ref-captured callback 同步, App 端 state 用 effect tick
 *   每秒 re-render 一次以更新等待秒数
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentSessionMode, AgentStatus, GoalInfo, ImageContent, ModelInfo } from "@shared/ipc";
import type { FileReference } from "../lib/file-attachment";
import { splitFilesForAttachment } from "../lib/file-attachment";
import { findCurrentModel, formatVisionModelExamples, modelSupportsImage } from "../lib/model-capability";
import { expandAtPathsInPrompt } from "../lib/expandAtPaths";
import { dbgLog, dbgTimer } from "@shared/debug-log";
import {
  appendPendingUser,
  makePendingUserId,
  removePendingUser,
  type ChatItem,
} from "../stores/chat-store";
import type { GoalModeApi } from "./useGoalMode";

/** 纯函数: 是否有可发送内容 (text / 图片 / 文件) */
export function hasSendableContent(
  input: string,
  attachments: ImageContent[],
  fileRefs: FileReference[],
): boolean {
  return Boolean(input.trim()) || attachments.length > 0 || fileRefs.length > 0;
}

/** 纯函数: 当前 model 是否支持图片 —— send 前的闸门, 避免静默丢图。 */
export function buildImageUnsupportedMessage(
  models: ModelInfo[],
  currentModelKey: string,
): string | null {
  if (modelSupportsImage(models, currentModelKey)) return null;
  const m = findCurrentModel(models, currentModelKey);
  const label = m ? `${m.provider}/${m.id}` : currentModelKey || "(未知)";
  return (
    `当前模型 ${label} 不支持图片,Pi SDK 会把整条 user message 替换为占位文本,截图发过去 AI 也看不到。` +
    `请切换到 vision 模型 (如 ${formatVisionModelExamples()}),或把图片以文件方式提供 (拖入或用 @ 引用路径)。`
  );
}

/** ApiStatus (与 useAgentEventRouter.ApiStatus 同步) */
export type ComposerApiStatus = {
  phase: "thinking" | "receiving" | "retrying";
  startedAt: number;
} | null;

/** Composer dispatcher 依赖 —— 纯工厂入参, 不含 React state */
export type ComposerDeps = {
  /** 当前 cwd, send 闸门 */
  cwd: string | null;
  /** 完整模型列表 + 当前 model key, 图片闸门 */
  models: ModelInfo[];
  currentModelKey: string;
  /** 状态 snapshot (read-only), dispatcher 调用方负责提供 */
  input: string;
  attachments: ImageContent[];
  fileRefs: FileReference[];
  /** status / sessionMode: send 闸门 + dbg log */
  status: AgentStatus;
  sessionMode: AgentSessionMode;
  /** goal: 给 onSend 时判断 /goal catch-all (goal 模式 + 目标未设条件) */
  goal: GoalInfo | null;
  /** setters —— 与 React setState 同形 */
  setInput: (input: string | ((prev: string) => string)) => void;
  setAttachments: (a: ImageContent[] | ((prev: ImageContent[]) => ImageContent[])) => void;
  setFileRefs: (f: FileReference[] | ((prev: FileReference[]) => FileReference[])) => void;
  setError: (error: string | null) => void;
  setFollowNonce: (n: number | ((prev: number) => number)) => void;
  /** setItems: pending bubble 增 / 删 */
  setItems: (items: ChatItem[] | ((prev: ChatItem[]) => ChatItem[])) => void;
  /** goal dispatcher: /goal 命令解析, 由 useGoalMode 工厂提供 */
  goalDispatcher: Pick<GoalModeApi, "handleGoalCommand">;
  /** refreshSessions: send 完成后强制刷新 sidebar */
  refreshSessions: () => Promise<void>;
};

export type ComposerApi = {
  /** send 当前 input / attachments / fileRefs. 返回 true 表示已发, false 表示被闸门挡住 (无内容 / 缺 cwd / 模型不支持图) */
  send: () => Promise<boolean>;
  /** abort 当前 turn */
  abort: () => Promise<void>;
  /** 添加拖入 / 粘贴的文件 (图片入 attachments, 其他入 fileRefs) */
  onAddFiles: (files: File[]) => Promise<void>;
  /** 移除第 index 张图片 */
  onRemoveImage: (index: number) => void;
  /** 移除第 index 个文件引用 */
  onRemoveFile: (index: number) => void;
  /** 发送 clarify 选择 (类似 send, 但 input 不清空, 失败时还原) */
  onClarifySelect: (reply: string) => Promise<void>;
  /** 是否有可发送内容 (read-only view) */
  canSend: () => boolean;
};

/**
 * 纯 dispatcher —— send / abort / addFiles / remove / clarify. 不依赖
 * React state, 单元测试目标。
 */
export function createComposerDispatcher(deps: ComposerDeps): ComposerApi {
  const {
    cwd,
    models,
    currentModelKey,
    input,
    attachments,
    fileRefs,
    status,
    sessionMode,
    setInput,
    setAttachments,
    setFileRefs,
    setError,
    setFollowNonce,
    setItems,
    goalDispatcher,
    refreshSessions,
  } = deps;

  /** 闸门: 无内容 / 无 cwd → 静默 no-op (UI 反馈由 ChatPanel 按钮 disabled 控) */
  const canSend = (): boolean => {
    if (!cwd) return false;
    return hasSendableContent(input, attachments, fileRefs);
  };

  /**
   * 主 send. 与原 App.tsx `send` 等价:
   * 1) hasContent / cwd 闸门
   * 2) 图片能力闸门 (model 不收图 → 报错 + 退出)
   * 3) /goal 命令解析 (走 goalDispatcher.handleGoalCommand)
   * 4) append pending user bubble
   * 5) expandAtPathsInPrompt + window.xAgent.turn.prompt
   * 6) 失败 / silent → 撤回 pending bubble + 报错
   * 7) refreshSessions
   */
  const send = async (): Promise<boolean> => {
    if (!canSend()) {
      dbgLog("chat", "send skipped", {
        hasText: Boolean(input.trim()),
        images: attachments.length,
        files: fileRefs.length,
        hasCwd: Boolean(cwd),
      });
      return false;
    }

    if (attachments.length > 0) {
      const imageError = buildImageUnsupportedMessage(models, currentModelKey);
      if (imageError) {
        setError(imageError);
        dbgLog("chat", "send blocked: model lacks image input", {
          currentModel: currentModelKey,
          imageCount: attachments.length,
        });
        return false;
      }
    }

    const text = input.trim();
    // Snapshot attachments / fileRefs before clearing input so we can
    // pass them into the IPC payload + expandAtPaths. Cleared below
    // to keep empty state on send.
    const currentAttachments = attachments;
    const currentFileRefs = fileRefs;
    setInput("");
    setAttachments([]);
    setFileRefs([]);
    setError(null);
    setFollowNonce((n) => n + 1);
    dbgLog("chat", "send invoked", {
      len: text.length,
      preview: text.slice(0, 80),
      status,
      sessionMode,
    });

    // Slash: /goal — 走 goal dispatcher
    if (await goalDispatcher.handleGoalCommand(text)) {
      // 注意: 走 /goal 路径不消耗 input(只清 goal / sessionMode), 但
      // App 原 send 已经在上面 setInput("") 清空, 这里不需再清
      return true;
    }

    // Show the bubble immediately — host events only arrive after
    // shadow-git checkpoint + Pi message_start (or history_replace at
    // turn end). 透传 currentAttachments 到 pending bubble, 让
    // UserBubble 在 user_message 事件回来后仍能显示已附图片
    // (#42 修复 #2: user bubble 缺图导致用户误判图丢了)。
    const pendingId = makePendingUserId();
    setItems((prev) => appendPendingUser(prev, text, pendingId, currentAttachments));

    const doneExpand = dbgTimer("chat", "expandAtPathsInPrompt");
    const expanded = await expandAtPathsInPrompt(text, currentFileRefs);
    doneExpand();
    const doneRoundtrip = dbgTimer("chat", "window.xAgent.turn.prompt roundtrip");
    const result = await window.xAgent.turn.prompt({
      text: expanded,
      images: currentAttachments.length > 0 ? currentAttachments : undefined,
    });
    doneRoundtrip();
    dbgLog("chat", "turn.prompt resolved", {
      ok: result.ok,
      silent: result.silent,
      error: result.error,
    });
    if (!result.ok || result.silent) {
      setItems((prev) => removePendingUser(prev, pendingId));
      if (!result.ok) setError(result.error ?? "发送失败");
    }
    await refreshSessions();
    return true;
  };

  const abort = async (): Promise<void> => {
    dbgLog("chat", "abort invoked");
    const done = dbgTimer("chat", "window.xAgent.turn.abort roundtrip");
    try {
      await window.xAgent.turn.abort();
      done();
    } catch (err) {
      dbgLog("chat", "abort threw", err instanceof Error ? err.message : String(err));
    }
  };

  const onAddFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    // 走 preload 暴露的 webUtils.getPathForFile 拿绝对路径
    // (Electron 32+ 不再自动挂 .path). webUtils 在 renderer 是
    // contextBridge 沙箱外的, 仅 preload 能 import; 我们通过
    // window.xAgentPath.getForFile 间接调用.
    const pathGetter = window.xAgentPath?.getForFile;
    const items = files.map((file) => {
      let absPath = "";
      try {
        absPath = pathGetter ? pathGetter(file) : "";
      } catch {
        absPath = "";
      }
      return { file, absPath, fallbackName: file.name };
    });
    const { images, references, notices } = await splitFilesForAttachment(items);
    if (images.length > 0) {
      setAttachments((prev) => [...prev, ...images]);
    }
    if (references.length > 0) {
      // 文件不进 input 文本 —— 由 ComposerAttachments 渲染成 chip
      // (跟图片附件同区域). 绝对路径存 fileRefs state, send 时
      // 走 expandAtPaths 展开成 <file> 块拼到 user message 末尾.
      setFileRefs((prev) => [...prev, ...references]);
    }
    if (notices.length > 0) {
      setError(notices.join("\n"));
    }
  };

  const onRemoveImage = (index: number): void => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const onRemoveFile = (index: number): void => {
    setFileRefs((prev) => prev.filter((_, i) => i !== index));
  };

  const onClarifySelect = async (reply: string): Promise<void> => {
    if (!cwd || !reply.trim()) return;
    const text = reply.trim();
    setError(null);
    setFollowNonce((n) => n + 1);
    const pendingId = makePendingUserId();
    setItems((prev) => appendPendingUser(prev, text, pendingId));
    const expanded = await expandAtPathsInPrompt(text);
    const result = await window.xAgent.turn.prompt({ text: expanded });
    if (!result.ok || result.silent) {
      setItems((prev) => removePendingUser(prev, pendingId));
      if (!result.ok) {
        setError(result.error ?? "发送失败");
        setInput(reply);
      }
    }
    await refreshSessions();
  };

  return {
    send,
    abort,
    onAddFiles,
    onRemoveImage,
    onRemoveFile,
    onClarifySelect,
    canSend,
  };
}

/** Composer api + view model. App 不传 input/attachments/fileRefs (hook 自有 state). */
export type UseComposerOpts = Omit<ComposerDeps, "input" | "attachments" | "fileRefs" | "setInput" | "setAttachments" | "setFileRefs">;

/**
 * React hook —— 持有 composer state (input / attachments / fileRefs /
 * apiStatus) + 暴露 dispatcher actions。
 *
 * apiStatus:
 * - 外部 (useAgentEventRouter) 通过 onApiStatus 注入 setter
 * - 内部 effect 每秒 tick 一次 re-render, 让 "已等待 Ns" 实时刷新
 * - apiStatusView 给 ChatPanel 直接用
 */
export function useComposer(opts: UseComposerOpts) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ImageContent[]>([]);
  const [fileRefs, setFileRefs] = useState<FileReference[]>([]);
  // apiStatus: 状态在 App, router 端通过 ref-captured callback 推过来
  const apiStatusRef = useRef<(status: ComposerApiStatus) => void>(() => undefined);
  const [apiStatus, setApiStatus] = useState<ComposerApiStatus>(null);
  useEffect(() => {
    apiStatusRef.current = setApiStatus;
  });
  // Tick once a second so the "已等待 Ns" counter re-renders while waiting.
  const [, setApiTick] = useState(0);
  useEffect(() => {
    if (!apiStatus) return;
    if (apiStatus.phase === "receiving") return;
    const id = setInterval(() => setApiTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [apiStatus]);
  // View-model for the composer: include waitedMs only when we have a start time.
  const apiStatusView = apiStatus
    ? apiStatus.phase === "receiving"
      ? { phase: "receiving" as const }
      : { phase: apiStatus.phase, waitedMs: Date.now() - apiStatus.startedAt }
    : null;

  const status = opts.status;
  const sessionMode = opts.sessionMode;
  const goal = opts.goal;

  // 每次 state 变都重建 dispatcher (useComposer 内部消费, 不是稳定
  // 引用, 不需要 useMemo / useCallback 锁定)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dispatcher = createComposerDispatcher({
    cwd: opts.cwd,
    models: opts.models,
    currentModelKey: opts.currentModelKey,
    input,
    attachments,
    fileRefs,
    status,
    sessionMode,
    goal,
    setInput,
    setAttachments,
    setFileRefs,
    setError: opts.setError,
    setFollowNonce: opts.setFollowNonce,
    setItems: opts.setItems,
    goalDispatcher: opts.goalDispatcher,
    refreshSessions: opts.refreshSessions,
  });

  const send = useCallback(() => dispatcher.send(), [dispatcher]);
  const abort = useCallback(() => dispatcher.abort(), [dispatcher]);
  const onAddFiles = useCallback(
    (files: File[]) => dispatcher.onAddFiles(files),
    [dispatcher],
  );
  const onRemoveImage = useCallback(
    (index: number) => dispatcher.onRemoveImage(index),
    [dispatcher],
  );
  const onRemoveFile = useCallback(
    (index: number) => dispatcher.onRemoveFile(index),
    [dispatcher],
  );
  const onClarifySelect = useCallback(
    (reply: string) => dispatcher.onClarifySelect(reply),
    [dispatcher],
  );
  const canSend = useCallback(
    () => dispatcher.canSend(),
    [dispatcher],
  );

  return {
    // state (read + write for App)
    input,
    setInput,
    attachments,
    setAttachments,
    fileRefs,
    setFileRefs,
    // apiStatus: 接 useAgentEventRouter.onApiStatus
    apiStatusRef,
    apiStatus,
    apiStatusView,
    // actions
    send,
    abort,
    onAddFiles,
    onRemoveImage,
    onRemoveFile,
    onClarifySelect,
    canSend,
  };
}

/** apiStatus re-export, 给 useAgentEventRouter 引用避免循环 import */
export type { ComposerApiStatus as ApiStatus };
