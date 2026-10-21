/** Validate actual diagnostics export, crash metadata and small-window controls in Electron. */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { launchApp, toggleToolPanel } from "./helpers";

/** Visibility alone misses title-bar occlusion; check layout bounds and the actual close-button hit target. */
async function expectSettingsHeaderAccessible(main: Page): Promise<void> {
  const geometry = await main.locator(".settings-modal").evaluate((panel) => {
    const header = panel.querySelector(".modal-head")!;
    const close = header.querySelector("button")!;
    const chrome = document.querySelector(".topbar")!.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const closeRect = close.getBoundingClientRect();
    const hitPoints = [closeRect.top + 2, closeRect.top + closeRect.height / 2, closeRect.bottom - 2];
    return {
      chromeBottom: chrome.bottom,
      headerTop: headerRect.top,
      panelBottom: panel.getBoundingClientRect().bottom,
      viewportHeight: window.innerHeight,
      closeUncovered: hitPoints.every((y) => close.contains(document.elementFromPoint(closeRect.left + closeRect.width / 2, y))),
    };
  });
  expect(geometry.headerTop, "Settings header must clear the native title-bar drag region").toBeGreaterThanOrEqual(geometry.chromeBottom + 8);
  expect(geometry.panelBottom).toBeLessThanOrEqual(geometry.viewportHeight - 8);
  expect(geometry.closeUncovered, "Every sampled point on the close button must belong to the dialog").toBe(true);
}

for (const scale of [1, 1.25, 1.5]) {
  test(`small window at Windows scale ${scale} keeps composer/settings reachable`, async ({}, testInfo) => {
    const { app, main, home } = await launchApp({ args: [`--force-device-scale-factor=${scale}`] });
    try {
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("renderer/index.html"))!;
        window.setContentSize(900, 600);
      });
      await expect(main.locator(".composer-send")).toBeInViewport();
      await expect(main.getByRole("button", { name: "会话模式", exact: true })).toBeInViewport();
      await toggleToolPanel(main);
      await expect(main.locator(".right-panel")).toBeInViewport();
      await toggleToolPanel(main);
      await main.screenshot({ path: testInfo.outputPath(`chat-${scale}.png`) });
      await main.locator('[title="设置（Ctrl+,）"]').click();
      await expect(main.locator(".settings-content")).toBeVisible();
      await expectSettingsHeaderAccessible(main);
      await main.locator(".settings-nav").getByRole("button", { name: "通用" }).click();
      const destination = join(home, "diagnostics-export.json");
      const originalClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
      await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, destination);
      await main.getByRole("button", { name: "导出诊断包" }).click();
      await expect.poll(() => existsSync(destination)).toBe(true);
      const snapshot = JSON.parse(readFileSync(destination, "utf8"));
      expect(snapshot.version).toBe(2);
      expect(snapshot.reportId).toMatch(/^[0-9a-f-]{36}$/);
      expect(Object.keys(snapshot.state).sort()).toEqual(["godotClients", "mode", "sessionActive", "status"]);
      expect(JSON.stringify(snapshot)).not.toContain(home);
      await main.getByText(/诊断预览（最近/).click();
      await expect(main.locator(".diagnostics-preview pre")).toContainText(snapshot.reportId);
      await expect(main.getByRole("button", { name: "复制反馈摘要" })).toBeVisible();
      try {
        await main.getByRole("button", { name: "复制反馈摘要" }).click();
        await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain(snapshot.reportId);
      } finally { await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), originalClipboard); }
      await main.screenshot({ path: testInfo.outputPath(`settings-${scale}.png`) });
      await main.getByRole("button", { name: "关闭设置", exact: true }).click();
      await expect(main.getByRole("dialog", { name: "设置", exact: true })).toBeHidden();
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes("renderer/index.html"))!.setContentSize(1280, 840);
      });
      await main.locator('[title="设置（Ctrl+,）"]').click();
      await expect(main.getByRole("heading", { name: "设置", exact: true })).toBeInViewport();
      await expectSettingsHeaderAccessible(main);
      await main.screenshot({ path: testInfo.outputPath(`settings-regular-${scale}.png`) });
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

test("network and abort Promise rejections keep the interface alive and never request restart", async () => {
  const { app, main } = await launchApp();
  try {
    await expect(main.locator(".composer-send")).toBeVisible();
    await app.evaluate(({ dialog }) => {
      (globalThis as unknown as { recoveryDialogs: number }).recoveryDialogs = 0;
      dialog.showMessageBox = () => {
        (globalThis as unknown as { recoveryDialogs: number }).recoveryDialogs++;
        return new Promise(() => {});
      };
    });
    for (const [message, reason, typeError] of [["Connection error.", "network", false], ["Request was aborted.", "aborted", false], ["Load failed", "network", true]] as const) {
      await main.evaluate(({ text, typeError }) => { void Promise.reject(typeError ? new TypeError(text) : new Error(text)); }, { text: message, typeError });
      await expect.poll(() => main.evaluate(async () => (await window.xAgent.appReport.getDiagnosticSnapshot()).events.at(-1))).toMatchObject({ kind: "renderer-rejection", reason });
      expect(await app.evaluate(() => (globalThis as unknown as { recoveryDialogs: number }).recoveryDialogs)).toBe(0);
      await expect(main.locator(".composer-send")).toBeVisible();
    }
    // Operational reports must not consume the fatal error latch.
    await main.evaluate(() => { setTimeout(() => { throw new TypeError("private programming failure"); }, 0); });
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { recoveryDialogs: number }).recoveryDialogs)).toBe(1);
    const snapshot = await main.evaluate(() => window.xAgent.appReport.getDiagnosticSnapshot());
    expect(snapshot.events.at(-1)).toMatchObject({ kind: "renderer-error", reason: "TypeError" });
    expect(JSON.stringify(snapshot)).not.toContain("private programming failure");
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
