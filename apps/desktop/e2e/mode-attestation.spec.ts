/** The compact mode selector must remain inert until a project is open. */
import { test, expect } from "@playwright/test";
import { launchApp } from "./helpers";

test("未打开项目时模式选择保持禁用且默认智能体", async () => {
  const { app, main } = await launchApp();
  try {
    const picker = main.getByRole("button", { name: "会话模式", exact: true });
    await expect(picker).toBeDisabled();
    await expect(picker).toHaveAttribute("aria-expanded", "false");
    await expect(main.locator(".composer-mode-select")).toHaveAttribute("data-mode", "agent");
    await expect(main.getByRole("listbox")).toHaveCount(0);
    expect((await main.evaluate(() => window.xAgent.plan.getMode())).mode).toBe("agent");
  } finally {
    await app.close();
  }
});
