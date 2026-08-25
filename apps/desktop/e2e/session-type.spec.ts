/**
 * E2E 策划会话类型契约 —— 验证 UI 三处:
 * 1. TopBar 双按钮存在, code 按钮可点, design 按钮可点
 * 2. 点「新策划会话」后 body[data-session-type="design"]
 * 3. 侧栏条目含 data-session-type="design" + .session-type-badge
 * 4. mode pills 仍可用 (mode 仍可在策划会话内切)
 * 5. 点「新代码会话」回到 body[data-session-type="code"], 侧栏无徽标
 *
 * 与 mode-switch.spec.ts 同模板, 通过 window.xAgent.workspace.open
 * 打开临时项目, 避免原生目录对话框.
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

    // 策划会话 chips: 应是策划专属 (含 "设计一个角色"), 不应是代码模式 chips
    // 同步策略: CI 上 .empty-state-starters / starter-chip 容器出现有 race,
    // 直接轮询 page.evaluate 看 #message-stream > .empty-state-starters 是否已挂载,
    // 比 toBeVisible 的 auto-retry 更稳. 拿到 chip 文本后再继续.
    try {
      await main.waitForFunction(
        () =>
          document.querySelectorAll('.starter-chip').length > 0 &&
          Array.from(document.querySelectorAll('.starter-chip')).some(
            (el) => (el.textContent || '').includes('设计一个角色'),
          ),
        null,
        { timeout: 20_000, polling: 100 },
      );
    } catch (e) {
      // 调试: dump 实际 DOM 状态帮助定位 CI 跟本机的差异
      const domDump = await main.evaluate(() => {
        const body = document.body;
        const chatPanel = document.querySelector('.chat-panel');
        const transcript = document.querySelector('.chat-transcript');
        const messageStream = document.querySelector('.message-stream');
        const inner = messageStream?.firstElementChild ?? null;
        const disabledEmptyProbe = document.querySelector(
          '.empty-state:not(.empty-state-starters)',
        );
        const allChips = Array.from(
          document.querySelectorAll('.starter-chip'),
        ).map((el) => el.textContent || '');
        return {
          bodySessionType: body.getAttribute('data-session-type'),
          messageStreamInnerClass: inner ? inner.className : null,
          innerChildren: inner ? Array.from(inner.children).map((c) => c.className) : null,
          disabledEmptyText: disabledEmptyProbe
            ? disabledEmptyProbe.textContent
            : null,
          starterChipsCount: allChips.length,
          starterChips: allChips,
        };
      });
      throw new Error(
        `design chip wait timed out. dom=${JSON.stringify(domDump)} err=${String(e)}`,
      );
    }
    await expect(
      main.locator('.starter-chip:has-text("设计一个角色")'),
    ).toBeVisible();
    await expect(
      main.locator('.starter-chip:has-text("审查当前脚本")'),
    ).toHaveCount(0);

    // 空对话中央徽章: 应显示 "策划模式" + data-session-type="design"
    // 紧跟 chips 断言后, 此时 React 树已就绪, badge 必定在 DOM.
    const designBadge = main.locator(".empty-state-session-type");
    await expect(designBadge).toBeVisible();
    await expect(designBadge).toHaveAttribute("data-session-type", "design");
    await expect(designBadge).toHaveText(/策划模式/);

    // 侧栏新条目应有 design 徽标
    // (新会话在侧栏最上; locator 选 first 即可)
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

    // 切回 code 后 chips 应回到代码模式 — tmp 目录不是 Godot 项目,
    // 走非 godotOnly 路径:只显示「了解项目结构」「帮我修一个问题」。
    // 注意:「审查当前脚本」是 godotOnly, 这里不能用; 想测全量 chip 请在 fixture 里塞 project.godot。
    // 同步策略同前: waitForFunction 直接轮询 DOM, 拿到 chip 文本后再继续.
    await main.waitForFunction(
      () =>
        document.querySelectorAll('.starter-chip').length > 0 &&
        Array.from(document.querySelectorAll('.starter-chip')).some(
          (el) => (el.textContent || '').includes('了解项目结构'),
        ) &&
        Array.from(document.querySelectorAll('.starter-chip')).every(
          (el) => !(el.textContent || '').includes('设计一个角色'),
        ),
      null,
      { timeout: 20_000, polling: 100 },
    );
    await expect(
      main.locator('.starter-chip:has-text("了解项目结构")'),
    ).toBeVisible();
    await expect(
      main.locator('.starter-chip:has-text("设计一个角色")'),
    ).toHaveCount(0);

    // 切回 code 后空对话徽章应显示 "代码模式"
    const codeBadge = main.locator(".empty-state-session-type");
    await expect(codeBadge).toBeVisible();
    await expect(codeBadge).toHaveAttribute("data-session-type", "code");
    await expect(codeBadge).toHaveText(/代码模式/);

    // 新代码会话的侧栏条目不应有 design 徽标
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
