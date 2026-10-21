/** Exercise native window behavior because custom chrome replaces operating-system title-bar buttons. */
import { test, expect } from "@playwright/test";
import { launchApp } from "./helpers";

test("titlebar maximizes, restores, minimizes and closes the native window", async () => {
  const { app, main } = await launchApp();
  try {
    const nativeWindow = await app.browserWindow(main);
    await expect(main.getByRole("button", { name: "最大化窗口", exact: true })).toBeVisible();
    await main.getByRole("button", { name: "最大化窗口", exact: true }).click();
    await expect.poll(() => nativeWindow.evaluate((window) => window.isMaximized())).toBe(true);
    await main.getByRole("button", { name: "还原窗口", exact: true }).click();
    await expect.poll(() => nativeWindow.evaluate((window) => window.isMaximized())).toBe(false);
    await main.getByRole("button", { name: "最小化窗口", exact: true }).click();
    await expect.poll(() => nativeWindow.evaluate((window) => window.isMinimized())).toBe(true);
    await nativeWindow.evaluate((window) => { window.restore(); window.show(); });
    await expect(main.getByRole("button", { name: "关闭窗口", exact: true })).toBeVisible();
    const closed = app.waitForEvent("close");
    await main.getByRole("button", { name: "关闭窗口", exact: true }).click();
    await closed;
  } finally { await app.close().catch(() => {}); }
});
