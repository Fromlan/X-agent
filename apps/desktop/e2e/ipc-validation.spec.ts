/**
 * E2E 契约 —— 服务端 schema 校验。
 *
 * 注意：mode 切换在 SessionModeController 里先检查 bundle（项目已打开），
 * 没打开项目时所有 setMode 都返回 { ok: false, error: "尚未打开项目" }，
 * 所以"合法/非法"对比测不到。要测真行为需要在打开项目的环境里跑。
 */
import { test, expect } from "@playwright/test";
import { launchApp } from "./helpers";

test("plan.setMode 通道签名存在", async () => {
  const { app, main } = await launchApp();
  try {
    const result = await main.evaluate(async () => {
      // mode 切换在 plan facade 下（不是 session）
      return {
        exists: typeof window.xAgent.plan.setMode === "function",
        // 没打开项目时 setMode 应返回 ok: false（不是抛错）
        noBundle: await window.xAgent.plan.setMode({ kind: "plan" }),
      };
    });
    expect(result.exists).toBe(true);
    expect(result.noBundle.ok).toBe(false);
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
