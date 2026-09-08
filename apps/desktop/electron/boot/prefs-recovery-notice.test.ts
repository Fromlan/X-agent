/**
 * Prefs 损坏恢复提示 (主题 E #62) — apply 转换 PrefsLoadResult,
 * consume 取走一次后清空. patchPrefs 副作用通过 fake timer / fs sandbox 隔离.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// patchPrefs 的 fs 副作用需要 prefs 的 sandbox; 用真实 setAgentDirOverrideForTests
// 隔离临时目录, 不影响 ~/.pi/agent.
vi.mock("../../shared/debug-log", () => ({
  dbgWarn: () => {},
  dbgLog: () => {},
}));

import {
  applyStartupPrefsLoad,
  consumePrefsRecoveryNotice,
  _resetPrefsRecoveryForTests,
} from "./prefs-recovery-notice";
import { setAgentDirOverrideForTests } from "../agent/prefs";

let AGENT_DIR: string;

beforeEach(() => {
  _resetPrefsRecoveryForTests();
  AGENT_DIR = mkdtempSync(join(tmpdir(), "x-agent-prefs-recover-"));
  setAgentDirOverrideForTests(AGENT_DIR);
});

describe("boot/prefs-recovery-notice", () => {
  it("ok=true 的结果不写入 notice", () => {
    applyStartupPrefsLoad({
      ok: true,
      prefs: { clientLogoId: "default" } as never,
      recovered: null,
    });
    expect(consumePrefsRecoveryNotice()).toBeNull();
  });

  it("ok=false + recovered: 写入 notice, consume 拿到后清空", () => {
    applyStartupPrefsLoad({
      ok: false,
      prefs: { clientLogoId: "default" } as never,
      recovered: {
        ok: false,
        backedUp: true,
        backupPath: "/tmp/x-agent.json.broken.bak",
        error: "Unexpected token in JSON",
      },
    });
    const notice = consumePrefsRecoveryNotice();
    expect(notice).toEqual({
      ok: false,
      backedUp: true,
      backupPath: "/tmp/x-agent.json.broken.bak",
      error: "Unexpected token in JSON",
    });
    // 二次 consume 应为空 (queue 语义)
    expect(consumePrefsRecoveryNotice()).toBeNull();
  });

  it("backedUp=true 时副作用 patchPrefs({}) 写默认 prefs (隔离到 tmp)", async () => {
    applyStartupPrefsLoad({
      ok: false,
      prefs: { clientLogoId: "default" } as never,
      recovered: {
        ok: false,
        backedUp: true,
        backupPath: "/tmp/whatever.bak",
        error: "corrupt",
      },
    });
    // patchPrefs 内部 store.mutate 是 microtask 同步触发, 但 await 让 setImmediate
    // 落盘; 真实 x-agent.json 在 AGENT_DIR 内被创建.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(existsSync(join(AGENT_DIR, "x-agent.json"))).toBe(true);
    // 清理
    rmSync(AGENT_DIR, { recursive: true, force: true });
  });
});
