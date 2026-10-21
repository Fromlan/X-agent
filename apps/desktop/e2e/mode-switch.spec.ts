/** The compact mode picker and keyboard shortcut must preserve real main-process mode transitions. */
import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("打开项目后可通过菜单和键盘切换四种会话模式", async () => {
  const project = mkdtempSync(join(tmpdir(), "x-agent-e2e-proj-"));
  const { app, main } = await launchApp();
  try {
    const picker = main.getByRole("button", { name: "会话模式", exact: true });
    await expect(picker).toBeDisabled();
    expect((await main.evaluate((cwd) => window.xAgent.workspace.open(cwd, "new"), project)).ok).toBe(true);
    await expect(picker).toBeEnabled();
    for (const [label, mode] of [["调研", "ask"], ["计划", "plan"], ["目标", "goal"], ["智能体", "agent"]]) {
      await picker.click();
      await expect(main.getByRole("listbox")).toBeVisible();
      await main.getByRole("option", { name: label, exact: true }).click();
      await expect(main.locator(".composer-mode-select")).toHaveAttribute("data-mode", mode);
      await expect.poll(() => main.evaluate(async () => (await window.xAgent.plan.getMode()).mode)).toBe(mode);
    }
    await picker.focus();
    await picker.press("Enter");
    await main.keyboard.press("ArrowDown");
    await main.keyboard.press("Enter");
    await expect(main.locator(".composer-mode-select")).toHaveAttribute("data-mode", "ask");
    await expect(picker).toHaveAttribute("aria-expanded", "false");
    await main.locator(".composer textarea").press("Shift+Tab");
    await expect(main.locator(".composer-mode-select")).toHaveAttribute("data-mode", "plan");
    await expect(main.locator("body")).toHaveAttribute("data-session-type", "code");
  } finally {
    await main.evaluate(() => window.xAgent.workspace.close()).catch(() => {});
    await app.close();
    rmSync(project, { recursive: true, force: true });
  }
});
