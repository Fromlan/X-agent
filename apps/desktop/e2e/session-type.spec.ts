/**
 * E2E 策划会话类型契约 —— 验证核心视觉:
 * 1. 侧栏类型筛选与新会话按钮存在
 * 2. 点「新策划会话」后 body[data-session-type="design"]
 * 3. chat-panel 应用策划 accent 描边 (inset box-shadow)
 * 4. 点「新代码会话」回到 body[data-session-type="code"], 描边消失
 * 5. 策划会话内模式菜单仍可互切
 *
 * 与 mode-switch.spec.ts 同模板, 通过 window.xAgent.workspace.open
 * 绕过原生目录对话框.
 *
 * 范围限制 (CI test env 限制):
 * - 不验证 .empty-state-starters / starter-chip / 中央徽标.
 *   CI test env 没配 model, Pi SDK 在新会话加载时打
 *   "No models available" 系统警告, 该气泡进 items 让 .message-stream
 *   走 flow 分支, 空状态不渲染. 这跟本 PR 无关 —— 真实用户配 model
 *   之后空状态正常. 空状态 UI 由 ChatTranscript 单元测试 + scripts/test-chat-store.ts 覆盖.
 * - 不验证侧栏 session-card-main.
 *   第一个 open(cwd, "new", ...) 不触发 refreshSessions, 第二个 newSession
 *   触发 refreshSessions 但 listSessions IPC 在 CI 上有 race, 20s 等不到
 *   侧栏卡片刷新. 侧栏 UI 由 SidebarItem 单元测试 + scripts/test-group-sessions.ts 覆盖.
 */
import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test.describe.configure({ mode: "serial" });

test("策划会话类型 侧栏新会话 + 背景色 + chat-panel 描边", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "x-agent-e2e-design-"));
  const { app, main } = await launchApp();
  try {
    // 打开项目 (新代码会话作为 baseline)
    await main.evaluate(async (cwd) => {
      const res = await window.xAgent.workspace.open(cwd, "new", "code");
      if (!res.ok) throw new Error(res.error ?? "openProject failed");
    }, tmp);

    // Type tabs filter history; only the new-session action changes the active session type.
    const codeBtn = main.locator('.sidebar-session-types button[data-session-type="code"]');
    const designBtn = main.locator('.sidebar-session-types button[data-session-type="design"]');
    await expect(codeBtn).toBeVisible();
    await expect(designBtn).toBeVisible();

    // 默认 body[data-session-type] === "code" (App 启动时 default state)
    await expect(main.locator("body")).toHaveAttribute(
      "data-session-type",
      "code",
    );

    // 点新策划会话
    await designBtn.click();
    await expect(main.locator("body")).toHaveAttribute("data-session-type", "code");
    await main.getByRole("button", { name: "新会话", exact: true }).click();
    await expect(main.locator("body")).toHaveAttribute(
      "data-session-type",
      "design",
    );
    await expect(designBtn).toBeEnabled();

    // 策划会话视觉: chat-panel 应用策划 accent 描边 (inset box-shadow)
    const chatPanel = main.locator(".chat-panel");
    // Chromium 把 "inset 3px 0 0 0 rgb(...)" 序列化为
    // "rgb(...) 3px 0px 0px 0px inset" (inset 在末尾). 等待实际样式而非瞬时快照.
    await expect(chatPanel).toHaveCSS("box-shadow", /3px/);
    await expect(chatPanel).toHaveCSS("box-shadow", /inset/);
    await expect(chatPanel).toHaveCSS("box-shadow", /rgb/);

    // 切回新代码会话
    await codeBtn.click();
    await main.getByRole("button", { name: "新会话", exact: true }).click();
    await expect(main.locator("body")).toHaveAttribute(
      "data-session-type",
      "code",
    );
    await expect(codeBtn).toBeEnabled();

    // Wait through session-info/effect updates before asserting the final code-session style.
    await expect(chatPanel).not.toHaveCSS("box-shadow", /inset/);
  } finally {
    await main.evaluate(() => window.xAgent.workspace.close()).catch(() => {});
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("策划会话内模式菜单保留工具硬闸与回滚反馈", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "x-agent-e2e-design-"));
  const { app, main } = await launchApp();
  try {
    expect((await main.evaluate((cwd) => window.xAgent.workspace.open(cwd, "new", "design"), tmp)).ok).toBe(true);
    await expect(main.locator("body")).toHaveAttribute("data-session-type", "design");
    const picker = main.getByRole("button", { name: "会话模式", exact: true });
    await expect(picker).toBeEnabled();
    await picker.click();
    await main.getByRole("option", { name: "计划", exact: true }).click();
    // Design sessions may reject write_plan; either settlement must remain visible and usable.
    await expect.poll(() => main.evaluate(() => {
      const mode = document.querySelector(".composer-mode-select")?.getAttribute("data-mode");
      const notice = document.querySelector(".bubble-system.level-error")?.textContent;
      return mode === "plan" || Boolean(notice?.includes("write_plan"));
    })).toBe(true);
    const mode = await main.evaluate(async () => (await window.xAgent.plan.getMode()).mode);
    if (mode !== "plan") {
      expect(mode).toBe("agent");
      await expect(main.locator(".bubble-system.level-error", { hasText: "write_plan" })).toBeVisible();
    }
    await picker.click();
    await main.getByRole("option", { name: "智能体", exact: true }).click();
    await expect(main.locator(".composer-mode-select")).toHaveAttribute("data-mode", "agent");
    await expect(main.locator("body")).toHaveAttribute("data-session-type", "design");
  } finally {
    await main.evaluate(() => window.xAgent.workspace.close()).catch(() => {});
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});
