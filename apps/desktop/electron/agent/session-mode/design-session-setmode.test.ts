/**
 * Vitest 套件 —— SessionModeController.setMode("plan") 在 design session
 * 下的回滚行为（#79 修复 + 锁定）。
 *
 * 不变量：
 * 1. design session + setMode("plan") → 返回 { ok: false, error 含 "write_plan" }
 * 2. design session + setMode("plan") 失败后 controller.getMode() 仍为 "agent"
 *    （rollback 已把 agentMode 恢复）
 * 3. design session + setMode("plan") 失败后 emitReplaceableNotice 被调用，
 *    replaceKey="plan"、level="error"、text 含 "write_plan" 与 "重开项目"
 * 4. code session + setMode("plan") → 正常进入 plan 模式（对照组，证明
 *    第 1-3 条是 design 专属行为而非通用逻辑）
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SessionModeController } from "./controller";
import type { SessionModeHost } from "./controller";
import { DEFAULT_SESSION_TYPE, type SessionType } from "../../../shared/session-type";
import type { AgentSession, DefaultResourceLoader, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { setAgentDirOverrideForTests } from "../prefs";

interface CapturedNotice {
  replaceKey: string;
  text: string;
  level: "info" | "warn" | "error";
}

function makeHostWithCaptures(opts: {
  sessionType?: SessionType;
  activeTools?: string[];
}): {
  host: SessionModeHost;
  notices: CapturedNotice[];
  events: Array<{ type: string; [k: string]: unknown }>;
} {
  const sessionType: SessionType = opts.sessionType ?? DEFAULT_SESSION_TYPE;
  const activeTools = opts.activeTools ?? ["read", "write"];
  const notices: CapturedNotice[] = [];
  const events: Array<{ type: string; [k: string]: unknown }> = [];
  const fakeSession = {
    isStreaming: false,
    model: { id: "test" },
    messages: [],
    tools: [...activeTools],
    getActiveToolNames: () => activeTools,
    setActiveToolsByName(names: string[]) {
      // mutate the closure array so the next getActiveToolNames() reflects it
      activeTools.length = 0;
      activeTools.push(...names);
    },
  } as unknown as AgentSession;
  const host: SessionModeHost = {
    getBundle: () => ({
      session: fakeSession,
      cwd: "D:/UGit/z-2",
      sessionPath: null,
      sessionType,
    }),
    getResourceLoader: () => null as unknown as DefaultResourceLoader,
    getBaseAppendPrompt: () => [],
    emit: (e) => {
      events.push(e as { type: string; [k: string]: unknown });
    },
    emitReplaceableNotice: (replaceKey, text, level = "info") => {
      notices.push({ replaceKey, text, level });
    },
    prompt: async () => ({ ok: true as const }),
    ensureRuntime: async () => ({}) as unknown as ModelRuntime,
    getLastTurnTokenTotal: () => 0,
    getActiveUserEntryId: () => null,
  };
  return { host, notices, events };
}

describe("SessionModeController.setMode(\"plan\") — design session rollback (#79)", () => {
  let setupDir: string;

  beforeEach(() => {
    // 把 prefs 落点隔离到 temp,避免污染 ~/.pi/agent/x-agent.json
    setupDir = `D:/UGit/.scratch/test-prefs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setAgentDirOverrideForTests(setupDir);
  });

  it("design + plan → ok:false, error 含 write_plan", async () => {
    const { host } = makeHostWithCaptures({ sessionType: "design" });
    const c = new SessionModeController(() => host);
    const result = await c.setMode("plan");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/write_plan/);
    }
  });

  it("design + plan 失败后 agentMode 仍是 agent (rollback 恢复成功)", async () => {
    const { host } = makeHostWithCaptures({ sessionType: "design" });
    const c = new SessionModeController(() => host);
    await c.setMode("plan");
    expect(c.getMode()).toBe("agent");
  });

  it("design + plan 失败后 emit 'plan' notice, level=error, text 含 write_plan 与 重开项目", async () => {
    const { host, notices } = makeHostWithCaptures({ sessionType: "design" });
    const c = new SessionModeController(() => host);
    await c.setMode("plan");
    const planNotices = notices.filter((n) => n.replaceKey === "plan");
    expect(planNotices).toHaveLength(1);
    expect(planNotices[0].level).toBe("error");
    expect(planNotices[0].text).toMatch(/write_plan/);
    expect(planNotices[0].text).toMatch(/重开项目/);
  });

  it("code + plan → ok:true, agentMode=plan, 不发 plan-error notice (对照组)", async () => {
    const { host, notices } = makeHostWithCaptures({
      sessionType: "code",
      // 必须含 write_plan,否则 code session 也会走 rollback
      activeTools: ["read", "write", "write_plan"],
    });
    const c = new SessionModeController(() => host);
    const result = await c.setMode("plan");
    expect(result.ok).toBe(true);
    expect(c.getMode()).toBe("plan");
    expect(notices.filter((n) => n.level === "error")).toHaveLength(0);
  });
});
