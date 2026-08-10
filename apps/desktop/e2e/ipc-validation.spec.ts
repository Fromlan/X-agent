/**
 * E2E 契约 —— 服务端 schema 校验：setSessionMode 拒绝非法模式。
 */
import { test, expect } from "@playwright/test";
import { launchApp } from "./helpers";

test("setSessionMode 拒绝非法模式", async () => {
  const { app, main } = await launchApp();
  try {
    const result = await main.evaluate(async () => {
      // 1. 合法模式
      const ok = await window.xAgent.session.setMode({ kind: "plan" });
      // 2. 非法模式
      const bad = await window.xAgent.session.setMode({ kind: "rogue" });
      // 3. 缺字段
      const missing = await window.xAgent.session.setMode({} as never);
      return { ok, bad, missing };
    });
    expect(result.ok.kind).toBe("plan");
    expect(result.bad.ok).toBe(false);
    expect(result.missing.ok).toBe(false);
  } finally {
    await app.close();
  }
});

test("workspace.open 拒绝空路径", async () => {
  const { app, main } = await launchApp();
  try {
    const result = await main.evaluate(async () => {
      const r = await window.xAgent.workspace.open("Z:/does/not/exist", "new");
      return { ok: r.ok, error: r.error };
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  } finally {
    await app.close();
  }
});
