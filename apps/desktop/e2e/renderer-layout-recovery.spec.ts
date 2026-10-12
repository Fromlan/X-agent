/** Native layout notifications must not terminate an otherwise healthy renderer. */
import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launchApp } from "./helpers";

/** Wait for bootstrap to reveal the native window before testing browser rendering or user actions. */
async function waitForMainWindow(app: ElectronApplication, main: Page): Promise<void> {
  const window = await app.browserWindow(main);
  // Keep observer/lifecycle delivery active on unattended Windows desktops without a foreground surface.
  await window.evaluate((window) => window.webContents.setBackgroundThrottling(false));
  await expect.poll(() => window.evaluate((window) => window.isVisible())).toBe(true);
}

/** Preserve isolated fixture geometry and browser state when a CI layout assertion fails. */
async function captureLayoutFailure(app: ElectronApplication, main: Page): Promise<void> {
  const renderer = await main.evaluate(async () => {
    const stream = document.querySelector<HTMLElement>(".message-stream");
    return {
      userAgent: navigator.userAgent, visibility: document.visibilityState, scale: devicePixelRatio,
      viewport: { width: innerWidth, height: innerHeight }, fonts: document.fonts.status,
      stream: stream && { top: stream.scrollTop, height: stream.scrollHeight, viewport: stream.clientHeight },
      rows: Array.from(document.querySelectorAll<HTMLElement>(".virtual-row")).map((row) => ({ index: row.dataset.index, height: row.offsetHeight, transform: row.style.transform })),
      diagnostics: await window.xAgent.appReport.getDiagnosticSnapshot(),
    };
  }).catch(() => null);
  const native = await app.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes("renderer/index.html"));
    return { bounds: window?.getBounds(), visible: window?.isVisible(), minimized: window?.isMinimized(), focused: window?.isFocused(), display: screen.getPrimaryDisplay().workArea };
  }).catch(() => null);
  await test.info().attach("layout-state", { body: JSON.stringify({ renderer, native }, null, 2), contentType: "application/json" });
  await main.screenshot({ path: test.info().outputPath("layout-failure.png") }).catch(() => {});
}

test("native ResizeObserver delivery warnings do not request fatal recovery", async () => {
  const { app, main } = await launchApp();
  try {
    await waitForMainWindow(app, main);
    await expect(main.locator(".composer-send")).toBeVisible();
    await app.evaluate(({ dialog }) => {
      (globalThis as unknown as { recoveryDialogs: number }).recoveryDialogs = 0;
      dialog.showMessageBox = () => {
        (globalThis as unknown as { recoveryDialogs: number }).recoveryDialogs++;
        return new Promise(() => {});
      };
    });
    const warning = await main.evaluate(() => new Promise<{ message: string; hasError: boolean }>((resolve, reject) => {
      const element = document.createElement("div");
      element.style.cssText = "position:fixed;left:0;top:0;width:100px;height:10px";
      const child = document.createElement("div");
      const grandchild = document.createElement("div");
      child.style.cssText = grandchild.style.cssText = "width:100px;height:10px";
      element.appendChild(child); child.appendChild(grandchild);
      const targets = [element, child, grandchild];
      document.body.appendChild(element);
      let deliveries = 0;
      let frames = 0;
      const entryCounts: number[] = [];
      let animation = 0;
      /** Keep requesting rendering steps while the CI desktop may have no pending paints. */
      const nextFrame = () => { frames++; animation = requestAnimationFrame(nextFrame); };
      animation = requestAnimationFrame(nextFrame);
      const observer = new ResizeObserver((entries) => {
        deliveries++;
        if (entryCounts.length < 10) entryCounts.push(entries.length);
        // Like WPT resize-observer/eventloop.html, resize several depths synchronously to leave ancestors undelivered.
        targets.forEach((target) => { target.style.width = `${100 + deliveries * 40}px`; });
      });
      /** Capture the browser-generated ErrorEvent, then remove the one-frame feedback loop. */
      const onError = (event: ErrorEvent) => {
        if (!event.message.startsWith("ResizeObserver loop")) return;
        clearTimeout(timeout);
        cancelAnimationFrame(animation);
        observer.disconnect(); element.remove(); window.removeEventListener("error", onError);
        const result = { message: event.message, hasError: event.error != null };
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(result)));
      };
      const timeout = setTimeout(() => {
        cancelAnimationFrame(animation);
        const state = { deliveries, frames, entryCounts, visibility: document.visibilityState, width: element.offsetWidth, userAgent: navigator.userAgent };
        observer.disconnect(); element.remove(); window.removeEventListener("error", onError);
        reject(new Error(`Native ResizeObserver fixture did not deliver a warning: ${JSON.stringify(state)}`));
      }, 10000);
      window.addEventListener("error", onError);
      targets.forEach((target) => observer.observe(target));
    }));
    expect(warning).toEqual({ message: "ResizeObserver loop completed with undelivered notifications.", hasError: false });
    const snapshot = await main.evaluate(() => window.xAgent.appReport.getDiagnosticSnapshot());
    expect(snapshot.state.status).toBe("idle");
    expect(snapshot.events.filter((event) => event.kind !== "operation")).toEqual([]);
    expect(await app.evaluate(() => (globalThis as unknown as { recoveryDialogs: number }).recoveryDialogs)).toBe(0);
    await expect(main.locator(".composer-send")).toBeVisible();
    // A real exception with the same message must still enter fatal recovery after the layout warning.
    await main.evaluate(() => { setTimeout(() => { throw new TypeError("ResizeObserver loop completed with undelivered notifications."); }, 0); });
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { recoveryDialogs: number }).recoveryDialogs)).toBe(1);
    expect((await main.evaluate(() => window.xAgent.appReport.getDiagnosticSnapshot())).events.at(-1)).toMatchObject({ kind: "renderer-error", reason: "TypeError" });
  } catch (error) { await captureLayoutFailure(app, main); throw error; }
  finally { await app.close(); }
});

test("a restored long conversation stays idle through delayed layout changes", async () => {
  const project = mkdtempSync(join(tmpdir(), "x-agent-restored-layout-"));
  const { app, main } = await launchApp({ args: ["--force-device-scale-factor=1.25"], prepare: (home) => {
    const sessionDir = join(home, ".pi", "agent", "x-agent", "sessions");
    mkdirSync(sessionDir, { recursive: true });
    const session = SessionManager.create(project, sessionDir);
    for (let index = 0; index < 36; index++) {
      const timestamp = Date.now() - 86400000 + index;
      session.appendMessage({ role: "user", content: `Restored question ${index}`, timestamp });
      session.appendMessage({
        role: "assistant", content: [{ type: "text", text: `### Restored reply ${index}\n\n${"Variable height restored content. ".repeat(8 + index % 9)}\n\n| Item | Value |\n| --- | --- |\n| Saved | ${index} |` }],
        api: "openai-completions", provider: "openai", model: "fixture", stopReason: "stop", timestamp,
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      });
    }
    session.appendSessionInfo("Restored layout fixture");
  } });
  try {
    await waitForMainWindow(app, main);
    await app.evaluate(({ dialog }) => {
      (globalThis as unknown as { recoveryDialogs: number }).recoveryDialogs = 0;
      dialog.showMessageBox = () => { (globalThis as unknown as { recoveryDialogs: number }).recoveryDialogs++; return new Promise(() => {}); };
    });
    // Use the user-facing resume path: it updates session identity and forces the transcript to follow its tail.
    await main.locator('.session-card-main[title="Restored layout fixture"]').click();
    await expect(main.locator(".message-stream-virtual")).toBeVisible();
    await expect(main.getByText("Restored reply 35", { exact: true })).toBeVisible();
    // Model late font/image reflow without sending a prompt or changing session state.
    await main.evaluate(() => new Promise<void>((resolve) => {
      let frames = 0;
      /** Change line wrapping across several observer deliveries before leaving the conversation idle. */
      const reflow = () => {
        const row = document.querySelector<HTMLElement>(".virtual-row");
        if (row) row.style.paddingBottom = `${frames % 3 * 8}px`;
        if (++frames < 20) requestAnimationFrame(reflow);
        else resolve();
      };
      requestAnimationFrame(reflow);
    }));
    await main.waitForTimeout(20000);
    const snapshot = await main.evaluate(() => window.xAgent.appReport.getDiagnosticSnapshot());
    expect(snapshot.state).toMatchObject({ status: "idle", sessionActive: true });
    expect(snapshot.events.filter((event) => event.kind !== "operation")).toEqual([]);
    expect(snapshot.events.some((event) => event.operation === "prompt")).toBe(false);
    expect(await app.evaluate(() => (globalThis as unknown as { recoveryDialogs: number }).recoveryDialogs)).toBe(0);
    await expect(main.getByText("Restored reply 35", { exact: true })).toBeVisible();
    await expect(main.locator(".composer textarea")).toBeEnabled();
  } catch (error) { await captureLayoutFailure(app, main); throw error; }
  finally { await app.close(); rmSync(project, { recursive: true, force: true }); }
});
