/**
 * E2E 冒烟 —— 应用可启动、主界面壳渲染、模式药丸按初始状态呈现。
 * 不打开项目、不写会话状态，作为 CI 上最稳的首个核心场景。
 */
import { test, expect } from "@playwright/test";
import { launchApp } from "./helpers";

test("应用启动后主窗口渲染完整壳", async () => {
  const { app, main } = await launchApp();
  try {
    await expect(main).toHaveTitle("X-agent");
    await expect(main.locator(".app-shell")).toBeVisible();
    // 会话模式药丸（智能体 / 调研 / 计划 / 目标）始终渲染
    await expect(main.locator('[data-mode="agent"]')).toBeVisible();
    await expect(main.locator('[data-mode="ask"]')).toBeVisible();
    await expect(main.locator('[data-mode="plan"]')).toBeVisible();
    await expect(main.locator('[data-mode="goal"]')).toBeVisible();
    // 未打开项目时默认模式 = 智能体
    await expect(main.locator('[data-mode="agent"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  } finally {
    await app.close();
  }
});
