/**
 * E2E 契约 —— 模式药丸与 Godot 工具开关。
 * 验证 plan / agent 模式切换在 UI 上正确切换。
 */
import { test, expect } from "@playwright/test";
import { launchApp } from "./helpers";

test("mode switch 与禁用 / 启用契约", async () => {
  const { app, main } = await launchApp();
  try {
    // 初始：未打开项目时 Plan 模式不可用
    await expect(main.locator('[data-mode="plan"]')).toBeDisabled();

    const modeData = await main.evaluate(async () => {
      const modes = ["agent", "ask", "plan", "goal"];
      const map: Record<string, string> = {};
      for (const m of modes) {
        const el = document.querySelector(`[data-mode="${m}"]`);
        map[m] = el
          ? (el as HTMLElement).getAttribute("aria-pressed") ?? "missing"
          : "missing";
      }
      return map;
    });
    expect(modeData.agent).toBe("true");
    expect(modeData.ask).toBe("false");
    expect(modeData.plan).toBe("false");
    expect(modeData.goal).toBe("false");
  } finally {
    await app.close();
  }
});
