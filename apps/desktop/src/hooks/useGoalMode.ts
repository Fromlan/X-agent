/**
 * `useGoalMode` —— Issue #61 主题 F C-202 (2026-08-31).
 *
 * 把散在 App.tsx 多处的 goal 状态机 (slash 命令解析 / mode cycle /
 * clear / pause / resume / set condition) 收到一个 hook 里, 同时把
 * `/goal ...` 的纯函数解析逻辑提到 `parseGoalCommand` 方便单测。
 *
 * 实现拆两层:
 * 1. `createGoalModeDispatcher(deps)` —— 纯工厂, 不依赖 React, 单元测试目标。
 * 2. `useGoalMode(opts)` —— 薄 React hook, useCallback 包裹, 把 setter
 *    注入到 dispatcher。
 */
import { useCallback, useMemo } from "react";
import type { AgentSessionMode, GoalInfo } from "@shared/ipc";
import { isRestorableGoalStatus } from "@shared/ipc";

/**
 * `/goal ...` 纯函数解析 —— 单测锁定契约, 不依赖 React / IPC.
 *
 * | 输入                                | 输出                          |
 * |-------------------------------------|-------------------------------|
 * | "/goal" 或 "/goal "                 | "show" (打印当前目标)         |
 * | "/goal clear"                       | "clear"                       |
 * | "/goal pause"                       | "pause"                       |
 * | "/goal resume" / "/goal continue"   | "resume"                      |
 * | "/goal <自由文本>" (非 clear/...)   | "set", condition=trim(文本)   |
 * | 其它                                | null (不是 goal 命令)         |
 */
export type ParsedGoalCommand =
  | { kind: "show" }
  | { kind: "clear" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "set"; condition: string };

export function parseGoalCommand(text: string): ParsedGoalCommand | null {
  const trimmed = text.trim();
  if (!/^\/goal\b/i.test(trimmed)) return null;
  // /goal 后无内容 → show
  if (/^\/goal\s*$/i.test(trimmed)) return { kind: "show" };
  // /goal clear
  if (/^\/goal\s+clear\b/i.test(trimmed)) return { kind: "clear" };
  // /goal pause
  if (/^\/goal\s+pause\b/i.test(trimmed)) return { kind: "pause" };
  // /goal resume / /goal continue
  if (
    /^\/goal\s+resume\b/i.test(trimmed) ||
    /^\/goal\s+continue\b/i.test(trimmed)
  ) {
    return { kind: "resume" };
  }
  // /goal <something> — 排除已经被识别的子命令 (clear/pause/resume/continue)
  const m = trimmed.match(/^\/goal\s+(.+)$/is);
  const arg = m?.[1]?.trim() ?? "";
  if (!arg) return { kind: "show" };
  if (/^(clear|pause|resume|continue)\b/i.test(arg)) return null;
  return { kind: "set", condition: arg };
}

/** sessionMode 循环顺序 —— UI "下一模式" 按钮共享。 */
export const MODE_CYCLE: AgentSessionMode[] = ["agent", "ask", "plan", "goal"];

/**
 * 依赖 (dispatcher 纯函数): 只用 setter, 不依赖 React state 本身。
 * 这样 dispatcher 可以在测试里直接调, 不用 mount hook。
 */
export type GoalModeDeps = {
  setGoal: (goal: GoalInfo | null) => void;
  setSessionMode: (mode: AgentSessionMode) => void;
  setPlanPath: (path: string | null) => void;
  setFollowNonce: (n: number | ((prev: number) => number)) => void;
  setError: (error: string | null) => void;
  /**
   * 清掉输入框里的 /goal 草稿 (避免下次 send 误触发)。useGoalMode
   * 不直接拥有 input state, 由 App 注入 (典型实现: 检查当前 input
   * 开头是否为 /goal, 若是则置空)。
   */
  onClearGoalDraft: () => void;
  goal: GoalInfo | null;
  sessionMode: AgentSessionMode;
};

export type GoalModeApi = {
  /**
   * 解析并执行 `/goal ...` slash 命令. 返回 true 表示消费了输入,
   * false 表示不是 goal 命令, 调用方继续走正常 send。
   *
   * 若当前已是 `sessionMode === "goal"` 且目标未设完成条件
   * (`!isRestorableGoalStatus(goal?.status)`), 则把整条 `text`
   * 直接作为完成条件, 跳过 slash 解析 —— 与原 App.tsx `send` 行为一致。
   */
  handleGoalCommand: (text: string) => Promise<boolean>;
  clearGoal: () => Promise<void>;
  pauseGoal: () => Promise<void>;
  resumeGoal: () => Promise<void>;
  setGoalCondition: (condition: string) => Promise<void>;
  changeSessionMode: (mode: AgentSessionMode) => Promise<void>;
  cycleSessionMode: () => Promise<void>;
};

/**
 * 纯 dispatcher —— 不依赖 React, 单元测试目标。
 * 与 useGoalMode 行为等价, 但可以直接在测试里调。
 */
export function createGoalModeDispatcher(deps: GoalModeDeps): GoalModeApi {
  const {
    setGoal,
    setSessionMode,
    setPlanPath,
    onClearGoalDraft,
    setFollowNonce,
    setError,
    goal,
    sessionMode,
  } = deps;

  const clearGoalSlashDraft = onClearGoalDraft;

  const clearGoal = async () => {
    const result = await window.xAgent.plan.clearGoal();
    if (!result.ok) {
      setError(result.error ?? "清除目标失败");
      return;
    }
    setGoal(null);
    setSessionMode("agent");
  };

  const pauseGoal = async () => {
    const result = await window.xAgent.plan.pauseGoal();
    if (!result.ok) {
      setError(result.error ?? "暂停目标失败");
      return;
    }
    if (result.goal) setGoal(result.goal);
  };

  const resumeGoal = async () => {
    const result = await window.xAgent.plan.resumeGoal();
    if (!result.ok) {
      setError(result.error ?? "继续目标失败");
      return;
    }
    if (result.goal) setGoal(result.goal);
    setSessionMode("goal");
  };

  const setGoalCondition = async (condition: string) => {
    const result = await window.xAgent.plan.setGoal(condition);
    if (!result.ok) {
      setError(result.error ?? "设置目标失败");
      return;
    }
    if (result.goal) setGoal(result.goal);
    setSessionMode("goal");
  };

  const changeSessionMode = async (mode: AgentSessionMode) => {
    const result = await window.xAgent.plan.setMode(mode);
    if (!result.ok) {
      setError(result.error ?? "切换模式失败");
      return;
    }
    if (result.info) {
      setSessionMode(result.info.mode);
      setPlanPath(result.info.planPath);
    }
    if (mode === "agent" || mode === "ask" || mode === "plan") {
      setGoal(null);
      clearGoalSlashDraft();
    }
    if (mode === "goal" && result.needGoalCondition) {
      clearGoalSlashDraft();
      setFollowNonce((n) => n + 1);
    }
  };

  const handleGoalCommand = async (text: string): Promise<boolean> => {
    // goal 模式 + 目标未设完成条件 → 整条消息即 condition
    if (
      sessionMode === "goal" &&
      !isRestorableGoalStatus(goal?.status)
    ) {
      await setGoalCondition(text);
      return true;
    }

    const parsed = parseGoalCommand(text);
    if (!parsed) return false;

    switch (parsed.kind) {
      case "show": {
        const g = await window.xAgent.plan.getGoal();
        setGoal(g);
        setError(
          g
            ? `目标 (${g.status}): ${g.condition} · ${g.turns}/${g.maxTurns} 轮 · ${g.tokensUsed}/${g.maxTokens} tok`
            : "当前无活跃目标。切换到「目标」模式后输入完成条件并发送。",
        );
        return true;
      }
      case "clear":
        await clearGoal();
        return true;
      case "pause":
        await pauseGoal();
        return true;
      case "resume":
        await resumeGoal();
        return true;
      case "set":
        await setGoalCondition(parsed.condition);
        return true;
    }
  };

  const cycleSessionMode = async () => {
    const idx = MODE_CYCLE.indexOf(sessionMode);
    const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length]!;
    await changeSessionMode(next);
  };

  return {
    handleGoalCommand,
    clearGoal,
    pauseGoal,
    resumeGoal,
    setGoalCondition,
    changeSessionMode,
    cycleSessionMode,
  };
}

/**
 * React hook —— 用 useCallback 包裹 dispatcher 暴露的方法, 让 App
 * composition root 用同一个调用面。
 */
export function useGoalMode(opts: GoalModeDeps): GoalModeApi {
  const d = useMemo(() => createGoalModeDispatcher(opts), [
    opts.setGoal,
    opts.setSessionMode,
    opts.setPlanPath,
    opts.onClearGoalDraft,
    opts.setFollowNonce,
    opts.setError,
    opts.goal,
    opts.sessionMode,
  ]);

  // 用 useCallback 锁定引用, 避免下游 useEffect 频繁触发
  return useMemo<GoalModeApi>(
    () => ({
      handleGoalCommand: d.handleGoalCommand,
      clearGoal: d.clearGoal,
      pauseGoal: d.pauseGoal,
      resumeGoal: d.resumeGoal,
      setGoalCondition: d.setGoalCondition,
      changeSessionMode: d.changeSessionMode,
      cycleSessionMode: d.cycleSessionMode,
    }),
    [d],
  );
}

// 避免 useCallback import 留下死代码 (上面 useMemo 实际够了, 留
// import 给未来扩展)。
void useCallback;
