/**
 * E2E 策划会话类型契约 —— 验证核心视觉:
 * 1. TopBar 双按钮存在
 * 2. 点「新策划会话」后 body[data-session-type="design"]
 * 3. chat-panel 应用策划 accent 描边 (inset box-shadow)
 * 4. 侧栏条目含 data-session-type="design" + .session-type-badge
 * 5. 点「新代码会话」回到 body[data-session-type="code"], 侧栏无徽标
 * 6. mode pills 仍可用 (mode 仍可在策划会话内切)
 *
 * 与 mode-switch.spec.ts 同模板, 通过 window.xAgent.workspace.open
 * 绕过原生目录对话框.
 *
 * 范围限制: 故意不验证 .empty-state-starters / starter-chip / 中央徽标.
 * CI 测试环境没配 model, Pi SDK 加载新会话时打 "No models available"
 * 系统警告 (system bubble, kind=system, level=warn), 该气泡进 items 让
 * .message-stream 走 flow 分支而非 empty 分支, 空状态不渲染.
 * 这跟本 PR 无关 —— 是测试环境缺 model, 真实用户配了 model 之后空状态正常.
 * 空状态的 UI 行为已在 ChatTranscript 单元测试 / scripts/test-chat-store.ts 覆盖.
 */
import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test.describe.configure({ mode: "serial" });

test("策划会话类型 TopBar + 背景色 + 侧栏徽标", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "x-agent-e2e-design-"));
  const { app, main } = await launchApp();
  try {
    // 打开项目 (新代码会话作为 baseline)
    await main.evaluate(async (cwd) => {
      const res = await window.xAgent.workspace.open(cwd, "new", "code");
      if (!res.ok) throw new Error(res.error ?? "openProject failed");
    }, tmp);

    // TopBar 应有两个新按钮 — 用 .topbar 限定,避免命中侧栏 session-card-main
    // (侧栏卡片也带 data-session-type,scope 不对会 strict mode 命中多个元素)。
    const codeBtn = main.locator('.topbar button[data-session-type="code"]');
    const designBtn = main.locator('.topbar button[data-session-type="design"]');
    await expect(codeBtn).toBeVisible();
    await expect(designBtn).toBeVisible();

    // 默认 body[data-session-type] === "code" (App 启动时 default state)
    await expect(main.locator("body")).toHaveAttribute(
      "data-session-type",
      "code",
    );

    // 点新策划会话
    await designBtn.click();
    await expect(main.locator("body")).toHaveAttribute(
      "data-session-type",
      "design",
    );

    // 策划会话视觉: chat-panel 应用策划 accent 描边 (inset box-shadow)
    const chatPanelBox = await main.locator(".chat-panel").evaluate(
      (el) => window.getComputedStyle(el).boxShadow,
    );
    // Chromium 把 "inset 3px 0 0 0 rgb(...)" 序列化为
    // "rgb(...) 3px 0px 0px 0px inset" (inset 在末尾). 匹配关键词对即可.
    expect(chatPanelBox).toMatch(/3px/);
    expect(chatPanelBox).toMatch(/inset/);
    expect(chatPanelBox).toMatch(/rgb/);

    // 侧栏新条目应有 design 徽标
    // (新会话在侧栏最上; locator 选 first 即可)
    // 用 waitForFunction 等侧栏刷新, 而不是直接 toBeVisible.
    await main.waitForFunction(
      () =>
        document.querySelectorAll('.session-card-main[data-session-type="design"]')
          .length > 0,
      null,
      { timeout: 20_000, polling: 100 },
    );
    const designCard = main
      .locator('.session-card-main[data-session-type="design"]')
      .first();
    await expect(designCard).toBeVisible();
    const badge = designCard.locator(".session-type-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute("data-session-type", "design");

    // 切回新代码会话
    await codeBtn.click();
    await expect(main.locator("body")).toHaveAttribute(
      "data-session-type",
      "code",
    );

    // 切回 code 后 chat-panel 的 inset 描边应消失
    const chatPanelBoxCode = await main.locator(".chat-panel").evaluate(
      (el) => window.getComputedStyle(el).boxShadow,
    );
    expect(chatPanelBoxCode).not.toMatch(/inset/);

    // 新代码会话的侧栏条目不应有 design 徽标
    await main.waitForFunction(
      () =>
        document.querySelectorAll(
          '.session-card-main[data-session-type="code"]',
        ).length > 0,
      null,
      { timeout: 20_000, polling: 100 },
    );
    const codeCard = main
      .locator('.session-card-main[data-session-type="code"]')
      .first();
    await expect(codeCard).toBeVisible();
    await expect(codeCard.locator(".session-type-badge")).toHaveCount(0);
  } finally {
    await main.evaluate(() => window.xAgent.workspace.close()).catch(() => {});
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("策划会话内 mode 切换 pills 仍可用", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "x-agent-e2e-design-"));
  const { app, main } = await launchApp();
  try {
    await main.evaluate(async (cwd) => {
      const res = await window.xAgent.workspace.open(cwd, "new", "design");
      if (!res.ok) throw new Error(res.error ?? "openProject failed");
    }, tmp);

    // 验证确实在 design 状态
    await expect(main.locator("body")).toHaveAttribute(
      "data-session-type",
      "design",
    );

    // 切到 plan 模式 (策划会话内 mode 仍可互切)
    const planPill = main.locator('[data-mode="plan"]');
    await expect(planPill).toBeEnabled();
    await planPill.click();
    await expect(planPill).toHaveAttribute("aria-pressed", "true");

    // body data-session-type 仍为 design (mode 不影响 type)
    await expect(main.locator("body")).toHaveAttribute(
      "data-session-type",
      "design",
    );

    // 切回 agent
    const agentPill = main.locator('[data-mode="agent"]');
    await agentPill.click();
    await expect(agentPill).toHaveAttribute("aria-pressed", "true");
  } finally {
    await main.evaluate(() => window.xAgent.workspace.close()).catch(() => {});
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});
