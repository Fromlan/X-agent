/**
 * E2E 契约 —— 启动失败报告通道。
 * 验证 getStartupReport 返回数组；启动期失败摘要可被 renderer 读取。
 */
import { test, expect } from "@playwright/test";
import { launchApp } from "./helpers";

test("getStartupReport 返回数组（即使无失败条目）", async () => {
  const { app, main } = await launchApp();
  try {
    const report = await main.evaluate(async () => {
      return window.xAgent.appReport.getStartupReport();
    });
    expect(Array.isArray(report)).toBe(true);
  } finally {
    await app.close();
  }
});

test("getPrefsRecoveryNotice + getSecretCodecStatus 通道可用", async () => {
  const { app, main } = await launchApp();
  try {
    const result = await main.evaluate(async () => {
      const notice = await window.xAgent.prefs.getRecoveryNotice();
      const codec = await window.xAgent.prefs.getSecretCodecStatus();
      return { notice, codec };
    });
    // notice 可能是 null（无损坏）但一定不是 undefined
    expect(result.notice === null || typeof result.notice === "object").toBe(true);
    expect(typeof result.codec).toBe("object");
    expect(typeof result.codec.available).toBe("boolean");
  } finally {
    await app.close();
  }
});
