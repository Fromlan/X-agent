/**
 * Session model / thinking-level config (issue #59 主题 A 提取).
 *
 * Lifted out of SessionHost so the host facade stays focused on
 * "接 Pi 事件 + 路由到子编排器". Model / thinking config is a discrete
 * config concern with no turn / retract coupling; it can live here.
 *
 * All mutations follow the "session 实际切换成功后才落 prefs" 模式 — 失败
 * 不污染 prefs (renderer 拿到的 prefs 总是真实生效的状态)。
 */
import { dbgLog } from "../../shared/debug-log";
import { patchPrefs } from "./prefs";
import { modelFromSession } from "./session-host-helpers";
import type { SessionBundle } from "./session-lifecycle";
import type { UiAgentEvent, ThinkingLevel } from "../../shared/ipc";

/** Snapshot deps for setModel / setThinkingLevel. The host captures these
 *  once and passes them into the helpers; helpers never read `this.*`. */
export interface SessionConfigDeps {
  getBundle(): SessionBundle | null;
  ensureRuntime(): Promise<{ getModel(provider: string, id: string): unknown }>;
  emit(event: UiAgentEvent): void;
  emitReplaceableNotice(
    replaceKey: "model",
    text: string,
    level?: "info" | "warn" | "error",
  ): void;
  emitUsageUpdate(): void;
}

/** 切换会话模型。校验通过并真正下发给 session 后再写 prefs. */
export async function setModel(
  deps: SessionConfigDeps,
  provider: string,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const bundle = deps.getBundle();
  if (!bundle) return { ok: false, error: "尚未打开项目" };
  // DEBUG(thinking-switch #30): 跟踪 setModel 调用链,排查周期 session_info
  dbgLog("setModel", "in", { provider, id });
  try {
    const runtime = await deps.ensureRuntime();
    const model = runtime.getModel(provider, id) as
      | { provider: string; id: string }
      | undefined;
    if (!model) {
      const error = `未找到模型 ${provider}/${id}`;
      dbgLog("setModel", "model-not-found", { provider, id });
      deps.emitReplaceableNotice("model", error, "error");
      return { ok: false, error };
    }
    // 先下发到 session，再持久化 prefs；任一步失败都不污染 prefs。
    await bundle.session.setModel(
      model as Parameters<typeof bundle.session.setModel>[0],
    );
    void patchPrefs({ provider, model: id });
    deps.emit({
      type: "session_info",
      sessionId: bundle.session.sessionId,
      cwd: bundle.cwd,
      model: modelFromSession(bundle.session),
      thinkingLevel: bundle.session.thinkingLevel as ThinkingLevel,
      availableThinkingLevels: bundle.session.getAvailableThinkingLevels(),
      sessionPath: bundle.sessionPath,
    });
    deps.emitUsageUpdate();
    deps.emitReplaceableNotice("model", `已切换模型：${provider}/${id}`);
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    deps.emitReplaceableNotice("model", `切换模型失败：${error}`, "error");
    return { ok: false, error };
  }
}

/** 切换会话 thinking level, 持久化钳制后的 effective level. */
export async function setThinkingLevel(
  deps: SessionConfigDeps,
  level: ThinkingLevel,
): Promise<{ ok: boolean; thinkingLevel?: ThinkingLevel }> {
  const bundle = deps.getBundle();
  if (!bundle) {
    dbgLog("setThinkingLevel", "no-bundle", { level });
    return { ok: false };
  }
  // DEBUG(thinking-switch #30): 跟踪 thinking 切换入参,排查"调了但 UI 没动"
  const currentBefore = bundle.session.thinkingLevel;
  dbgLog("setThinkingLevel", "in", {
    requested: level,
    currentBefore,
    available: bundle.session.getAvailableThinkingLevels(),
  });
  bundle.session.setThinkingLevel(level);
  // Persist the model-clamped effective level so prefs / TopBar / Settings stay
  // aligned (e.g. DeepSeek V4 maps medium→high; unsupported → nearest).
  const effective = bundle.session.thinkingLevel as ThinkingLevel;
  dbgLog("setThinkingLevel", "after-set", {
    requested: level,
    effective,
    changedVsBefore: effective !== currentBefore,
    // 标记 Pi 是否把目标级别钳制了(available levels 不含) — 切换被静默回弹的根因
    clamped: effective !== level,
  });
  // Await the persist: renderer follows this IPC with `prefs.get()`, and a
  // fire-and-forget write can leave a stale cache that clobbers the effective
  // level it just received via session_info (composer snap-back bug).
  await patchPrefs({ thinkingLevel: effective });
  deps.emit({
    type: "session_info",
    sessionId: bundle.session.sessionId,
    cwd: bundle.cwd,
    model: modelFromSession(bundle.session),
    thinkingLevel: effective,
    availableThinkingLevels: bundle.session.getAvailableThinkingLevels(),
    sessionPath: bundle.sessionPath,
  });
  return { ok: true, thinkingLevel: effective };
}
