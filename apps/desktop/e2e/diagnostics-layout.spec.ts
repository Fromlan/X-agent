/** Validate actual diagnostics export, crash metadata and small-window controls in Electron. */
import { test, expect } from "@playwright/test";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { launchApp } from "./helpers";

for (const scale of [1, 1.25, 1.5]) {
  test(`small window at Windows scale ${scale} keeps composer/settings reachable`, async ({}, testInfo) => {
    const { app, main, home } = await launchApp({ args: [`--force-device-scale-factor=${scale}`] });
    try {
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("renderer/index.html"))!;
        window.setContentSize(900, 600);
      });
      await expect(main.locator(".composer-send")).toBeInViewport();
      await expect(main.locator('[data-mode="plan"]')).toBeInViewport();
      await main.locator('[title="打开工具面板"]').click();
      await expect(main.locator(".right-panel")).toBeInViewport();
      await main.locator('.topbar [title="收起工具面板"]').click();
      await main.screenshot({ path: testInfo.outputPath(`chat-${scale}.png`) });
      await main.locator('[title="设置（Ctrl+,）"]').click();
      await expect(main.locator(".settings-content")).toBeVisible();
      await main.locator(".settings-nav").getByRole("button", { name: "通用" }).click();
      const destination = join(home, "diagnostics-export.json");
      await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, destination);
      await main.getByRole("button", { name: "导出诊断包" }).click();
      await expect.poll(() => existsSync(destination)).toBe(true);
      const snapshot = JSON.parse(readFileSync(destination, "utf8"));
      expect(snapshot.version).toBe(1);
      expect(Object.keys(snapshot.state).sort()).toEqual(["godotClients", "mode", "sessionActive", "status"]);
      expect(JSON.stringify(snapshot)).not.toContain(home);
      await main.screenshot({ path: testInfo.outputPath(`settings-${scale}.png`) });
      await main.keyboard.press("Escape");
      await expect(main.locator(".composer-send")).toBeInViewport();
    } finally { await app.close(); }
  });
}

test("a real renderer crash records only bounded crash metadata", async () => {
  const { app, main, home } = await launchApp();
  try {
    await main.evaluate(() => window.xAgent.appReport.getDiagnosticSnapshot());
    await app.evaluate(({ BrowserWindow, dialog }) => {
      // Keep the recovery choice pending so the test can inspect disk before the user-selected restart/exit.
      dialog.showMessageBox = () => new Promise(() => {});
      BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("renderer/index.html"))!.webContents.forcefullyCrashRenderer();
    });
    const file = join(home, ".pi", "agent", "x-agent", "diagnostics", "events.json");
    await expect.poll(() => existsSync(file)).toBe(true);
    await expect.poll(() => JSON.parse(readFileSync(file, "utf8")).some((e: { kind: string }) => e.kind === "renderer-gone")).toBe(true);
    expect(readFileSync(file, "utf8")).not.toContain(home);
  } finally { await app.close(); }
});

test("a real uncaught main exception records metadata and exits instead of continuing", async () => {
  const { app, home } = await launchApp({ cleanupOnClose: false });
  const nativeProcess = app.process();
  try {
    const closed = app.waitForEvent("close");
    await app.evaluate(({ dialog }) => {
      dialog.showErrorBox = () => {};
      setImmediate(() => { throw new TypeError("placeholder-secret and private source must never be exported"); });
    });
    await closed;
    expect(nativeProcess.exitCode).toBe(1);
    const file = join(home, ".pi", "agent", "x-agent", "diagnostics", "events.json");
    const events = JSON.parse(readFileSync(file, "utf8"));
    expect(events.some((e: { kind: string }) => e.kind === "main-exception")).toBe(true);
    expect(readFileSync(file, "utf8")).not.toContain("placeholder-secret");
    expect(readFileSync(file, "utf8")).not.toContain("private source");
  } finally {
    if (nativeProcess.exitCode === null) await app.close();
    rmSync(home, { recursive: true, force: true });
  }
});
