/**
 * SessionHost 暴露给 3 个子编排器 (SessionLifecycle / SessionModeController /
 * RetractOrchestrator) 的窄 interface 集合. 2026-08-31 收口 (issue #59 主题 A):
 *
 * 之前 3 个 host-bag 适配器 (asLifecycleAccess / asModeHost / asRetractHost) 在
 * session-host.ts:151-223 直接返回 22/8/10 字段的对象,leverage ≈ 0.
 * 现拆为 4 个按关注点切分的 interface,子编排器只 import 自己需要的.
 *
 * 接口边界 (而非 "host bag" 大对象) 的好处:
 * - 子编排器可独立单测 (mock 4 个 interface 即可,不必造整个 SessionHost)
 * - typecheck 立即捕获"加了字段忘更新某 orchestrator"
 * - 关注点分离: 资源 / 事件 / cwd / 运行时各归各位
 */
import type {
  AgentSession,
  DefaultResourceLoader,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentStatus,
  HistoryItem,
  NoticeReplaceKey,
  PromptPayload,
  PromptResult,
  TurnUsage,
  UiAgentEvent,
} from "../../shared/ipc";
import type { SessionBundle } from "./session-lifecycle";
import type { TurnFileTracker } from "./turn-file-tracker";
import type { ShadowCheckpointTracker } from "./shadow-checkpoints";
import type { SessionModeController } from "./session-mode";
import type { GodotRpcBridge } from "./godot-rpc-bridge";
import type { ToolDetailRecord } from "./session-host-helpers";

/** 资源只读视图: bundle / loader / basePrompt / 子 tracker / 子 controller. */
export interface ResourceState {
  getBundle(): SessionBundle | null;
  getResourceLoader(): DefaultResourceLoader | null;
  getBaseAppendPrompt(): string[];
  fileTracker: TurnFileTracker;
  shadowCheckpoints: ShadowCheckpointTracker;
  sessionMode: SessionModeController;
  godotRpc: GodotRpcBridge | null;
  /** Last assistant turn token total (0 if unknown). */
  getLastTurnTokenTotal(): number;
  /** Active user turn entry id (for goal budget ledger), if any. */
  getActiveUserEntryId(): string | null;
}

/** 事件总线: emit / notice / status / usage / history replace. */
export interface EventBus {
  emit(event: UiAgentEvent): void;
  emitReplaceableNotice(
    replaceKey: NoticeReplaceKey,
    text: string,
    level?: "info" | "warn" | "error",
  ): void;
  setStatus(status: AgentStatus, error?: string): void;
  emitUsageUpdate(): void;
  emitHistoryReplace(): void;
}

/** Cwd-orchestrating operations: bridge events / runtime / prompt. */
export interface CwdOps {
  pruneToolDetailsToBranch(): void;
  ensureRuntime(): Promise<ModelRuntime>;
  bridgeEvents(session: AgentSession): () => void;
  prompt(payload: PromptPayload | string): Promise<PromptResult>;
  /** True while a prompt is mid-flight (model call in progress). */
  promptPreparing: boolean;
  isPromptPreparing(): boolean;
}

/** 运行时状态: 互斥运行 / 指纹 / tool 详情 / 可变状态 setter / retract 回调. */
export interface RuntimeState {
  runReplaceExclusive<T>(fn: () => Promise<T>): Promise<T>;
  historyFingerprint(items: HistoryItem[]): string;
  toolDetails: Map<string, ToolDetailRecord>;
  // Mutable state setters
  setBundle(bundle: SessionBundle | null): void;
  setResourceLoader(loader: DefaultResourceLoader | null): void;
  setBaseAppendPrompt(base: string[]): void;
  setLastTurnUsage(u: TurnUsage | undefined): void;
  clearCompactionState(): void;
  setAutoTitleInFlight(v: boolean): void;
  setLastHistoryFingerprint(fp: string | null): void;
  /** Retract orchestrator 完成后通知 sessionMode rollback goal. */
  onRetractSuccess(abandonedUserEntryIds: string[]): void;
}

// ============ 3 个子编排器专用窄类型 ============
// SessionHost 用 Pick<> 组合 4 个 interface 后传给对应子编排器.
// 子编排器只 import 自己需要的 type,看不到 host 全貌.

/** SessionLifecycle: 唯一同时拿到 ResourceState + EventBus + CwdOps + RuntimeState
 *  全量的子编排器. 负责 open / resume / dispose / createSession 完整生命周期. */
export type SessionLifecycleHost = ResourceState & EventBus & CwdOps & RuntimeState;

/** SessionModeController: 4 case 模式互锁,只需要读资源 + emit notice + prompt + ensureRuntime. */
export type SessionModeHost = Pick<
  ResourceState,
  | "getBundle"
  | "getResourceLoader"
  | "getBaseAppendPrompt"
  | "getLastTurnTokenTotal"
  | "getActiveUserEntryId"
> &
  Pick<EventBus, "emit" | "emitReplaceableNotice"> &
  Pick<CwdOps, "ensureRuntime" | "prompt">;

/** RetractOrchestrator: 撤回 pipeline,需要 bundle/tracker + status/history + prompt + onRetractSuccess. */
export type RetractOrchestratorHost = Pick<
  ResourceState,
  "getBundle" | "fileTracker" | "shadowCheckpoints"
> &
  Pick<EventBus, "setStatus" | "emitHistoryReplace" | "emitUsageUpdate"> &
  Pick<CwdOps, "pruneToolDetailsToBranch" | "prompt" | "promptPreparing" | "isPromptPreparing"> &
  Pick<RuntimeState, "onRetractSuccess">;
