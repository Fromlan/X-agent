/**
 * Vitest 套件 —— SessionModeController.composeModeAppend 在 design session
 * 下的 system append 注入行为 (#40 follow-up).
 *
 * 锁住 4 个不变量:
 * 1. design session + 任意 mode → 注入 buildDesignSessionTypeAppend()
 * 2. design session + 任意 mode → 追加 buildGameDesignLayoutGuide()
 * 3. design session 注入的工具白名单出现 read/grep/find/ls/bash/write/edit
 * 4. code session → 不注入 design append, 也不注入 GDD layout guide
 *
 * 通过 mock 一个最小 SessionModeHost (不依赖 Pi SDK) 来跑。
 */
import { describe, it, expect } from "vitest";
import { SessionModeController } from "./controller";
import type { SessionModeHost } from "./controller";
import { DEFAULT_SESSION_TYPE, type SessionType } from "../../../shared/session-type";
import type { AgentSession, DefaultResourceLoader, ModelRuntime } from "@earendil-works/pi-coding-agent";

/** Build a minimal fake SessionModeHost for composeModeAppend-only tests. */
function makeHost(opts: {
  sessionType?: SessionType;
  activeTools?: string[];
  baseAppend?: string[];
}): SessionModeHost {
  const sessionType: SessionType = opts.sessionType ?? DEFAULT_SESSION_TYPE;
  const activeTools = opts.activeTools ?? ["read", "write"];
  const baseAppend = opts.baseAppend ?? [];
  // Minimal AgentSession fake: only getActiveToolNames is touched by
  // refreshSystemPrompt path; composeModeAppend itself does not call it.
  const fakeSession = {
    getActiveToolNames: () => activeTools,
  } as unknown as AgentSession;
  return {
    getBundle: () => ({
      session: fakeSession,
      cwd: "D:/UGit/z-2",
      sessionPath: null,
      sessionType,
    }),
    getResourceLoader: () => null,
    getBaseAppendPrompt: () => baseAppend,
    emit: () => {},
    emitReplaceableNotice: () => {},
    prompt: async () => ({ ok: true as const }),
    ensureRuntime: async () => ({}) as unknown as ModelRuntime,
    getLastTurnTokenTotal: () => 0,
    getActiveUserEntryId: () => null,
  };
}

describe("SessionModeController.composeModeAppend — design session", () => {
  it("design + agent mode: 注入 design append + GDD layout guide", () => {
    const c = new SessionModeController(() => makeHost({ sessionType: "design" }));
    const out = c.composeModeAppend([]);
    const joined = out.join("\n\n");
    // design append 标题
    expect(joined).toContain("# X-agent Design session type");
    // GDD layout guide 标题
    expect(joined).toContain("# X-agent GDD layout guide");
  });

  it("design + agent mode: 8 个 design 工具名都出现 (read/grep/find/ls/bash/write/edit/godot_detect_project)", () => {
    const c = new SessionModeController(() => makeHost({ sessionType: "design" }));
    const out = c.composeModeAppend([]).join("\n");
    for (const name of [
      "`read`",
      "`grep`",
      "`find`",
      "`ls`",
      "`bash`",
      "`write`",
      "`edit`",
      "`godot_detect_project`",
    ]) {
      expect(out).toContain(name);
    }
  });

  it("design + agent mode: 不再含 'modes internally' 误导措辞 (#40 follow-up)", () => {
    const c = new SessionModeController(() => makeHost({ sessionType: "design" }));
    const out = c.composeModeAppend([]).join("\n");
    expect(out).not.toMatch(/modes internally/);
  });

  it("design + plan mode: 同样注入 design append + GDD layout (与 4 mode 正交)", () => {
    const c = new SessionModeController(() => makeHost({ sessionType: "design" }));
    c.setMode("plan").catch(() => {});
    const out = c.composeModeAppend([]).join("\n");
    // plan mode 自身不进入 (write_plan 在 design tools 里没有, setMode 会失败回滚),
    // 但 design session 的 type append 仍注入
    expect(out).toContain("# X-agent Design session type");
    expect(out).toContain("# X-agent GDD layout guide");
  });

  it("GDD layout guide 显式禁止 summary / audit / integration-plan 变体", () => {
    const c = new SessionModeController(() => makeHost({ sessionType: "design" }));
    const out = c.composeModeAppend([]).join("\n");
    expect(out).toMatch(/summary\.md/);
    expect(out).toMatch(/audit\.md/);
    expect(out).toMatch(/integration-plan\.md/);
  });
});

describe("SessionModeController.composeModeAppend — code session", () => {
  it("code + agent mode: 不注入 design append 也不注入 GDD layout guide", () => {
    const c = new SessionModeController(() => makeHost({ sessionType: "code" }));
    const out = c.composeModeAppend([]).join("\n");
    expect(out).not.toContain("# X-agent Design session type");
    expect(out).not.toContain("# X-agent GDD layout guide");
  });
});
