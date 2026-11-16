/**
 * E2E 共享启动工具：构建产物 `out/` 启动 Electron 主应用并等待主窗口就绪。
 * 启动路径基于 `apps/desktop/package.json` 的 `main`（out/main/index.js）。
 */
import { _electron, type ElectronApplication, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

// 仓库 `"type": "module"`：用 import.meta.url 定位 apps/desktop 根目录
const APPS_DESKTOP = fileURLToPath(new URL("..", import.meta.url));

/** Remove only this helper's temporary home, letting Windows release dictionary handles between retries. */
async function cleanupFixtureHome(home: string): Promise<void> {
  const target = resolve(home);
  if (dirname(target).toLowerCase() !== resolve(tmpdir()).toLowerCase() || !basename(target).startsWith("x-agent-e2e-home-")) {
    throw new Error("Refusing to remove an unexpected E2E fixture directory");
  }
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

/** Keep cleanup failures separate from assertions and never block Electron's process-exit delivery. */
function reportCleanupFailure(error: unknown): void {
  console.warn("E2E fixture cleanup failed after Electron exited:", error);
}

/** Inspect live windows as well as future navigation so an early main-window event cannot be missed. */
async function waitForRendererWindow(app: ElectronApplication): Promise<Page> {
  return new Promise<Page>((resolveWindow, reject) => {
    const nativeProcess = app.process();
    /** Release every listener and timer before settling this one startup wait. */
    const cleanup = (): void => {
      clearInterval(poll);
      clearTimeout(timeout);
      app.off("close", onClose);
    };
    /** Fail promptly if native startup ends without a renderer instead of waiting the full timeout. */
    const onClose = (): void => {
      cleanup();
      reject(new Error(`Electron exited before its renderer was ready (code=${nativeProcess.exitCode}, signal=${nativeProcess.signalCode})`));
    };
    /** Require the actual renderer URL, including windows already present when launch resolves. */
    const inspect = (): void => {
      const renderer = app.windows().find((page) => !page.isClosed() && page.url().includes("renderer/index.html"));
      if (renderer) { cleanup(); resolveWindow(renderer); }
      else if (nativeProcess.exitCode !== null || nativeProcess.signalCode !== null) onClose();
    };
    const poll = setInterval(inspect, 50);
    const timeout = setTimeout(() => {
      const windows = app.windows().map((page) => ({ url: page.url(), closed: page.isClosed() }));
      cleanup();
      reject(new Error(`Electron renderer window was not ready within 60000ms; observed windows: ${JSON.stringify(windows)}`));
    }, 60_000);
    app.once("close", onClose);
    inspect();
  });
}

export async function launchApp(options: { env?: Record<string, string>; args?: string[]; prepare?: (home: string) => void; cleanupOnClose?: boolean } = {}): Promise<{
  app: ElectronApplication;
  main: Page;
  home: string;
}> {
  const home = mkdtempSync(join(tmpdir(), "x-agent-e2e-home-"));
  options.prepare?.(home);
  const app = await _electron.launch({
    // `electron .`：Electron 通过 package.json main 字段加载 out/main/index.js
    args: [".", `--user-data-dir=${join(home, "chromium")}`, "--enable-logging=stderr", ...(options.args ?? [])],
    cwd: APPS_DESKTOP,
    env: {
      ...process.env,
      // E2E 可能与本机已运行的 X-agent 实例并存 → 放开单实例锁
      X_AGENT_ALLOW_MULTI: "1",
      USERPROFILE: home,
      HOME: home,
      PI_CODING_AGENT_DIR: join(home, ".pi", "agent"),
      ...options.env,
    },
  }).catch(async (error: unknown) => {
    await cleanupFixtureHome(home).catch(reportCleanupFailure);
    throw error;
  });
  // The application close event can precede native process termination and retained Windows file handles.
  if (options.cleanupOnClose !== false) {
    const nativeProcess = app.process();
    const cleanup = () => { void cleanupFixtureHome(home).catch(reportCleanupFailure); };
    if (nativeProcess.exitCode !== null || nativeProcess.signalCode !== null) cleanup();
    else nativeProcess.once("close", cleanup);
  }
  try {
    // 启动有 splash 窗口；主窗口 URL 为 file://…/renderer/index.html
    const main = await waitForRendererWindow(app);
    await main.waitForLoadState("domcontentloaded");
    return { app, main, home };
  } catch (error) {
    // A failed bootstrap must not leave a native process behind or replace the original startup error.
    await app.close().catch(() => undefined);
    throw error;
  }
}

/** Secondary commands are reached through the visible workspace disclosure. */
export async function toggleToolPanel(main: Page): Promise<void> {
  if (await main.locator(".right-panel").isVisible()) {
    // In narrow windows the panel overlays the chat header; its own close command remains visible.
    await main.locator(".rp-nav").getByRole("button", { name: "收起工具面板", exact: true }).click();
    return;
  }
  await main.getByLabel("工作区选项", { exact: true }).click();
  await main.getByRole("button", { name: "切换工具面板", exact: true }).click();
}
