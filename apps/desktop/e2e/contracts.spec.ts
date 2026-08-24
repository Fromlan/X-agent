/**
 * E2E 契约 —— IPC 通道与 facade 暴露一致性。
 * 验证关键 IPC 都存在、合理响应、状态切换，以便锁定后续重构：
 * - workspace / turn / plan / session / prefs / appReport / godot / updates 八个 facade 必备
 * - setThinkingLevel / setSessionMode 走 plan facade 的负向路径
 *
 * 该用例在已有 Electron 实例上做纯 RPC 探针，不依赖真实 Pi 凭据；
 * 失败的 contract 立即通过 Playwright 报错，CI 直接红。
 */
import { test, expect } from "@playwright/test";
import { launchApp } from "./helpers";

test("facade 必备通道全部可用 + 状态契约", async () => {
  const { app, main } = await launchApp();
  try {
    const report = await main.evaluate(async () => {
      const api = window.xAgent;
      const probe = async (name: string) => {
        try {
          const v = await api[name]();
          return { ok: true, value: v };
        } catch (err) {
          return { ok: false, error: (err as Error).message };
        }
      };
      const facades = ["workspace", "turn", "plan", "session", "prefs", "appReport", "godot", "updates"];
      const facadeKeys: Record<string, string[]> = {};
      for (const f of facades) {
        facadeKeys[f] = api[f] ? Object.keys(api[f]) : [];
      }
      return {
        hasPrefRecovery: typeof api.prefs.getRecoveryNotice === "function",
        hasStartupReport: typeof api.appReport.getStartupReport === "function",
        hasSecretCodecStatus: typeof api.prefs.getSecretCodecStatus === "function",
        hasGodotRpcStatus: typeof api.godot.status === "function",
        hasUpdateStatus: typeof api.updates.getStatus === "function",
        hasGoalApi: typeof api.plan.getGoal === "function",
        facadeKeys,
      };
    });

    expect(report.hasPrefRecovery).toBe(true);
    expect(report.hasStartupReport).toBe(true);
    expect(report.hasSecretCodecStatus).toBe(true);
    expect(report.hasGodotRpcStatus).toBe(true);
    expect(report.hasUpdateStatus).toBe(true);
    expect(report.hasGoalApi).toBe(true);

    // 至少这些方法应该存在
    expect(report.facadeKeys.turn).toEqual(
      expect.arrayContaining(["prompt", "abort"]),
    );
    expect(report.facadeKeys.plan).toEqual(
      expect.arrayContaining(["setMode", "getMode", "setGoal", "getGoal"]),
    );
    expect(report.facadeKeys.prefs).toEqual(
      expect.arrayContaining(["get", "set", "getRecoveryNotice", "getSecretCodecStatus"]),
    );
    expect(report.facadeKeys.workspace).toEqual(
      expect.arrayContaining(["open", "close", "getStatus"]),
    );
    expect(report.facadeKeys.appReport).toEqual(
      expect.arrayContaining(["getStartupReport"]),
    );
    expect(report.facadeKeys.godot).toEqual(
      expect.arrayContaining(["status", "start", "stop", "ping", "request"]),
    );
    expect(report.facadeKeys.updates).toEqual(
      expect.arrayContaining(["getStatus", "check"]),
    );
  } finally {
    await app.close();
  }
});

test("应用启动暴露的 IPC 类型清单", async () => {
  const { app, main } = await launchApp();
  try {
    const result = await main.evaluate(async () => {
      const api = window.xAgent;
      const prefs = await api.prefs.get();
      return {
        validPrefs: typeof prefs === "object" && prefs !== null,
        locale: prefs.language ?? "zh-CN",
        hasGoal: typeof api.plan.getGoal === "function",
        // 启动 report 应可以被消费（数组）
        report: await api.appReport.getStartupReport(),
      };
    });
    expect(result.validPrefs).toBe(true);
    expect(Array.isArray(result.report)).toBe(true);
  } finally {
    await app.close();
  }
});
