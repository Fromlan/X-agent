/**
 * E2E 共享启动工具：构建产物 `out/` 启动 Electron 主应用并等待主窗口就绪。
 * 启动路径基于 `apps/desktop/package.json` 的 `main`（out/main/index.js）。
 */
import { _electron, type ElectronApplication, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// 仓库 `"type": "module"`：用 import.meta.url 定位 apps/desktop 根目录
const APPS_DESKTOP = fileURLToPath(new URL("..", import.meta.url));

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
  }).catch((error: unknown) => {
    rmSync(home, { recursive: true, force: true });
    throw error;
  });
  if (options.cleanupOnClose !== false) app.on("close", () => rmSync(home, { recursive: true, force: true }));
  // 启动有 splash 窗口；主窗口 URL 为 file://…/renderer/index.html
  const main = await app.waitForEvent("window", {
    predicate: (win) => win.url().includes("renderer/index.html"),
    timeout: 60_000,
  });
  await main.waitForLoadState("domcontentloaded");
  return { app, main, home };
}
