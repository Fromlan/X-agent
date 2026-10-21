/**
 * E2E 冒烟 —— 应用可启动、主界面壳渲染、模式选择器按初始状态呈现。
 * 不打开项目、不写会话状态，作为 CI 上最稳的首个核心场景。
 */
import { test, expect } from "@playwright/test";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("应用启动后主窗口渲染完整壳", async () => {
  const { app, main } = await launchApp();
  try {
    await expect(main).toHaveTitle("X-agent");
    await expect(main.locator(".app-shell")).toBeVisible();
    await expect(main.locator(".topbar-brand")).toHaveText("X-agent");
    await expect(main.locator(".topbar button")).toHaveCount(3);
    await expect(main.locator(".sidebar-actions").getByRole("button", { name: "打开项目", exact: true })).toBeVisible();
    await expect(main.locator(".sidebar-footer").getByRole("button", { name: "设置", exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "会话模式", exact: true })).toBeDisabled();
    await expect(main.locator(".composer-mode-select")).toHaveAttribute("data-mode", "agent");
    await expect(main.locator(".chat-header h1")).toHaveText("开始新的创作");
  } finally {
    await app.close();
  }
});

test("旧版品牌配置失效且通用设置只保留应用默认标识", async ({}, testInfo) => {
  const uuid = "7f3c0a4d-1234-5678-9abc-def012345678";
  const { app, main, home } = await launchApp({ prepare: (home) => {
    const agentDir = join(home, ".pi", "agent");
    const uploads = join(agentDir, "x-agent-logos");
    mkdirSync(uploads, { recursive: true });
    copyFileSync(new URL("../public/logo.png", import.meta.url), join(uploads, `${uuid}.png`));
    writeFileSync(join(agentDir, "x-agent.json"), JSON.stringify({
      themeId: "nord", colorMode: "dark", showThinking: false, clientLogoId: `custom:${uuid}`,
    }));
  } });
  try {
    const upload = join(home, ".pi", "agent", "x-agent-logos", `${uuid}.png`);
    const originalUpload = readFileSync(upload);
    const prefs = await main.evaluate(() => window.xAgent.prefs.get());
    expect(prefs).toMatchObject({ themeId: "nord", showThinking: false });
    expect(prefs).not.toHaveProperty("clientLogoId");
    expect(await main.evaluate(() => "logo" in window.xAgent)).toBe(false);
    await expect(main.locator('link[rel="icon"]')).toHaveAttribute("href", /(?:^|\/)favicon\.png$/);
    await main.locator(".sidebar-footer").getByRole("button", { name: "设置", exact: true }).click();
    await main.locator(".settings-nav").getByRole("button", { name: "通用", exact: true }).click();
    await expect(main.getByRole("heading", { name: "外观", exact: true })).toBeVisible();
    await expect(main.getByRole("heading", { name: "品牌", exact: true })).toHaveCount(0);
    await expect(main.getByRole("radiogroup", { name: "内置 logo 预设", exact: true })).toHaveCount(0);
    await expect(main.getByRole("button", { name: "上传自定义…", exact: true })).toHaveCount(0);
    await main.screenshot({ path: testInfo.outputPath("general-without-logo-picker.png") });
    await main.getByRole("button", { name: "关闭设置", exact: true }).click();
    await main.evaluate(() => window.xAgent.prefs.set({ showThinking: true }));
    const saved = JSON.parse(readFileSync(join(home, ".pi", "agent", "x-agent.json"), "utf8"));
    expect(saved.themeId).toBe("nord");
    expect(saved).not.toHaveProperty("clientLogoId");
    expect(readFileSync(upload)).toEqual(originalUpload);
  } finally { await app.close(); }
});
