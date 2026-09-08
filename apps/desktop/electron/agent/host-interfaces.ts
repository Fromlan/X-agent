/**
 * SessionHost 暴露给 3 个子编排器 (SessionLifecycle / SessionModeController /
 * RetractOrchestrator) 的窄 interface 集合. 2026-08-31 收口 (issue #59 主题 A):
 *
 * 之前 3 个 host-bag 适配器 (asLifecycleAccess / asModeHost / asRetractHost) 在
 * session-host.ts:151-223 直接返回 22/8/10 字段的对象,leverage ≈ 0.
 * 现拆为 3 个按关注点切分的 interface,子编排器只 import 自己需要的.
 *
 * 接口边界 (而非 "host bag" 大对象) 的好处:
 * - 子编排器可独立单测 (mock 3 个 interface 即可,不必造整个 SessionHost)
 * - typecheck 立即捕获"加了字段忘更新某 orchestrator"
 * - 关注点分离: 资源 / 事件 / cwd-锁态 各归各位
 *
 * C-108 收口:`NoticeReplaceKey` 在 `shared/ipc.ts` 是唯一 source-of-truth,
 * 本文件 re-export,子编排器走 host 类型即可拿到 (3 个子模块不再手抄联合类型,
 * controller 之前漏 "extension" 的 drift 一并根治). 2026-08-31 改口.
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type {
  AgentStatus,
  HistoryItem,
  NoticeReplaceKey,
  PromptPayload,
  PromptResult,
  TurnUsage,
  UiAgentEvent,
} from "../../shared/ipc";
// C-108: host family 显式 re-export 单一源,3 个子编排器经 host 类型间接拿到,
// 自身不再手抄联合类型(防止 controller 漏 "extension" 之类 drift 复发).
export type { NoticeReplaceKey } from "../../shared/ipc";
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

/**
 * Cwd-bound 锁态: cwd 变更时的所有可变状态 + 操作都在这一面.
 *
 * 合并自原 CwdOps (bridge / runtime / prompt) + RuntimeState (互斥运行 / 指纹 /
 * tool 详情 / 可变 setter / retract 回调),因为它们语义上都"被 cwd 锁定" —
 * cwd 切换(createSession / resume)前后整套状态必须一致释放/重绑。
 *
 * 子编排器通过 Pick<, 字段名> 选择自己需要的几个方法,不需要的子编排器完全
 * 看不到(类型即文档)。原先的 4 → 3 合并后,SessionHost 内部 4 个
 * asResourceState / asEventBus / asCwdLock / asRuntimeState 的窄 helper 收成 3 个;
 * 子编排器拿到的 host 对象 spread 三个 helper 即可。
 */
export interface CwdLock {
  // ---- 原 CwdOps ----
  pruneToolDetailsToBranch(): void;
  ensureRuntime(): Promise<ModelRuntime>;
  bridgeEvents(session: AgentSession): () => void;
  prompt(payload: PromptPayload | string): Promise<PromptResult>;
  /** True while a prompt is mid-flight (model call in progress). */
  promptPreparing: boolean;
  isPromptPreparing(): boolean;
  // ---- 原 RuntimeState ----
  runReplaceExclusive<T>(fn: () => Promise<T>): Promise<T>;
  historyFingerprint(items: HistoryItem[]): string;
  toolDetails: Map<string, ToolDetailRecord>;
  // Mutable state setters — 全部走 CwdLock,不暴露 raw 字段
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
// SessionHost 把 3 个窄 helper spread 进 host 对象传给对应子编排器.
// 子编排器只 import 自己需要的 type,看不到 host 全貌.
// (host-bag 适配器方法 asSessionLifecycleHost / asSessionModeHost / asRetractOrchestratorHost 已删.)

/** SessionLifecycle: 唯一同时拿到 ResourceState + EventBus + CwdLock 全量的子编排器.
 *  负责 open / resume / dispose / createSession 完整生命周期. */
export type SessionLifecycleHost = ResourceState & EventBus & CwdLock;

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
  Pick<CwdLock, "ensureRuntime" | "prompt">;

/** RetractOrchestrator: 撤回 pipeline,需要 bundle/tracker + status/history + prompt + onRetractSuccess. */
export type RetractOrchestratorHost = Pick<
  ResourceState,
  "getBundle" | "fileTracker" | "shadowCheckpoints"
> &
  Pick<EventBus, "setStatus" | "emitHistoryReplace" | "emitUsageUpdate"> &
  Pick<
    CwdLock,
    "pruneToolDetailsToBranch" | "prompt" | "promptPreparing" | "isPromptPreparing" | "onRetractSuccess"
  >;
