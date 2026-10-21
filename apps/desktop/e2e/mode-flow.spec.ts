/** Project lifecycle enables the picker and preserves Plan / Ask state across the IPC boundary. */
import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("打开与关闭项目时模式菜单禁用状态保持一致", async () => {
  const project = mkdtempSync(join(tmpdir(), "xagent-e2e-proj-"));
  const { app, main } = await launchApp();
  try {
    const picker = main.getByRole("button", { name: "会话模式", exact: true });
    await expect(picker).toBeDisabled();
    expect((await main.evaluate((cwd) => window.xAgent.workspace.open(cwd, "new"), project)).ok).toBe(true);
    await expect(picker).toBeEnabled();
    await expect(main.locator(".composer-mode-select")).toHaveAttribute("data-mode", "agent");
    for (const [label, mode] of [["计划", "plan"], ["调研", "ask"]]) {
      await picker.click();
      await main.getByRole("option", { name: label, exact: true }).click();
      await expect(main.locator(".composer-mode-select")).toHaveAttribute("data-mode", mode);
      await expect.poll(() => main.evaluate(async () => (await window.xAgent.plan.getMode()).mode)).toBe(mode);
    }
    await main.evaluate(() => window.xAgent.workspace.close());
    await expect(picker).toBeDisabled();
  } finally {
    await main.evaluate(() => window.xAgent.workspace.close()).catch(() => {});
    await app.close();
    rmSync(project, { recursive: true, force: true });
  }
});
