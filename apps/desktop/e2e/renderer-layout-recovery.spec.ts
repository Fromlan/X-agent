/** Native layout notifications must not terminate an otherwise healthy renderer. */
import { test, expect } from "@playwright/test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launchApp } from "./helpers";

test("native ResizeObserver delivery warnings do not request fatal recovery", async () => {
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
    const warning = await main.evaluate(() => new Promise<{ message: string; hasError: boolean }>((resolve) => {
      const element = document.createElement("div");
      element.style.cssText = "position:absolute;width:1px;height:1px";
      document.body.appendChild(element);
      let resized = false;
      const observer = new ResizeObserver(() => {
        if (!resized) { resized = true; element.style.height = "2px"; }
      });
      /** Capture the browser-generated ErrorEvent, then remove the one-frame feedback loop. */
      const onError = (event: ErrorEvent) => {
        if (!event.message.startsWith("ResizeObserver loop")) return;
        observer.disconnect(); element.remove(); window.removeEventListener("error", onError);
        const result = { message: event.message, hasError: event.error != null };
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(result)));
      };
      window.addEventListener("error", onError);
      observer.observe(element);
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
  } finally { await app.close(); }
});

test("a restored long conversation stays idle through delayed layout changes", async () => {
  const project = mkdtempSync(join(tmpdir(), "x-agent-restored-layout-"));
  let sessionPath = "";
  const { app, main } = await launchApp({ args: ["--force-device-scale-factor=1.25"], prepare: (home) => {
    const sessionDir = join(home, ".pi", "agent", "x-agent", "sessions", "layout-fixture");
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
    sessionPath = session.getSessionFile()!;
  } });
  try {
    await app.evaluate(({ dialog }) => {
      (globalThis as unknown as { recoveryDialogs: number }).recoveryDialogs = 0;
      dialog.showMessageBox = () => { (globalThis as unknown as { recoveryDialogs: number }).recoveryDialogs++; return new Promise(() => {}); };
    });
    expect((await main.evaluate((path) => window.xAgent.workspace.resume(path), sessionPath)).ok).toBe(true);
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
  } finally { await app.close(); rmSync(project, { recursive: true, force: true }); }
});
