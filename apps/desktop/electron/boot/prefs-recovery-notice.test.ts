/**
 * Prefs 损坏恢复提示 (主题 E #62) — apply 转换 PrefsLoadResult,
 * consume 取走一次后清空. patchPrefs 副作用通过 fs sandbox 隔离并等待实际落盘.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

// Writes are awaited by each recovery case before resetting the shared store path.
afterEach(() => {
  setAgentDirOverrideForTests(null);
  rmSync(AGENT_DIR, { recursive: true, force: true });
});

describe("boot/prefs-recovery-notice", () => {
  it("ok=true 的结果不写入 notice", () => {
    applyStartupPrefsLoad({
      ok: true,
      prefs: { themeId: "default" } as never,
      recovered: null,
    });
    expect(consumePrefsRecoveryNotice()).toBeNull();
  });

  it("ok=false + recovered: 写入 notice, consume 拿到后清空", async () => {
    applyStartupPrefsLoad({
      ok: false,
      prefs: { themeId: "default" } as never,
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
    await vi.waitFor(() => {
      expect(existsSync(join(AGENT_DIR, "x-agent.json"))).toBe(true);
    });
  });

  it("backedUp=true 时副作用 patchPrefs({}) 写默认 prefs (隔离到 tmp)", async () => {
    applyStartupPrefsLoad({
      ok: false,
      prefs: { themeId: "default" } as never,
      recovered: {
        ok: false,
        backedUp: true,
        backupPath: "/tmp/whatever.bak",
        error: "corrupt",
      },
    });
    // Wait for the atomic write, rather than assuming disk I/O finishes within 50 ms.
    await vi.waitFor(() => {
      expect(existsSync(join(AGENT_DIR, "x-agent.json"))).toBe(true);
    });
  });
});
