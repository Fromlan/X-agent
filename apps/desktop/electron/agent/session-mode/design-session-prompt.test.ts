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
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionModeController } from "./controller";
import type { SessionModeHost } from "./controller";
import { DEFAULT_SESSION_TYPE, type SessionType } from "../../../shared/session-type";
import type { AgentSession, DefaultResourceLoader, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { buildAgentWorkingAppend } from "../../../shared/agent-instructions";
import type { AgentSessionMode } from "../../../shared/ipc";
import { setAgentDirOverrideForTests } from "../prefs";

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
    setActiveToolsByName: vi.fn(),
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

  it("GDD layout guide 按当前项目与需求组织，避免固定游戏模板", () => {
    const c = new SessionModeController(() => makeHost({ sessionType: "design" }));
    const out = c.composeModeAppend([]).join("\n");
    expect(out).toContain("only when the game's scope or the user requires it");
    expect(out).not.toContain("07-峰的选择.md");
  });
});

describe("stable shared working rules", () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "x-agent-working-rules-"));
    setAgentDirOverrideForTests(directory);
  });
  afterEach(() => {
    setAgentDirOverrideForTests(null);
    rmSync(directory, { recursive: true, force: true });
  });

  it.each(["code", "design"] as const)("%s 在所有模式保留通用规则和用户 append", (type) => {
    const c = new SessionModeController(() => makeHost({ sessionType: type }));
    const base = ["User project guidance"];
    for (const mode of ["agent", "ask", "plan", "goal"] as const) {
      const out = c.composeModeAppend(base, type, mode);
      expect(out[0]).toBe(base[0]);
      expect(out.filter((block) => block === buildAgentWorkingAppend())).toHaveLength(1);
      const joined = out.join("\n\n");
      expect(joined.includes("# X-agent Ask mode")).toBe(mode === "ask");
      expect(joined.includes("# X-agent Plan mode")).toBe(mode === "plan");
    }
    expect(base).toEqual(["User project guidance"]);
  });

  it("反复切换与刷新时替换缓存，保留重载后的用户规则且不累积旧模式", () => {
    const base = ["User append v1"];
    const cached: string[] = [];
    const host = makeHost({ baseAppend: base });
    host.getResourceLoader = () => ({
      getAppendSystemPrompt: () => cached,
    }) as DefaultResourceLoader;
    const c = new SessionModeController(() => host);
    const modes: AgentSessionMode[] = ["ask", "plan", "agent", "ask", "agent"];
    for (const mode of modes) {
      c.setAgentMode(mode);
      c.refreshSystemPrompt();
      expect(cached).toEqual(c.composeModeAppend(base));
    }
    base[0] = "User append v2 after reload";
    c.refreshAfterResourceReload();
    expect(cached[0]).toBe(base[0]);
    expect(cached.filter((block) => block === buildAgentWorkingAppend())).toHaveLength(1);
    expect(cached.join("\n")).not.toContain("User append v1");
    expect(cached.join("\n")).not.toContain("# X-agent Ask mode");
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
