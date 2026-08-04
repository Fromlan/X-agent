/**
 * E2E 共享启动工具：构建产物 `out/` 启动 Electron 主应用并等待主窗口就绪。
 * 启动路径基于 `apps/desktop/package.json` 的 `main`（out/main/index.js）。
 */
import { _electron, type ElectronApplication, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

// 仓库 `"type": "module"`：用 import.meta.url 定位 apps/desktop 根目录
const APPS_DESKTOP = fileURLToPath(new URL("..", import.meta.url));

export async function launchApp(): Promise<{
  app: ElectronApplication;
  main: Page;
}> {
  const app = await _electron.launch({
    // `electron .`：Electron 通过 package.json main 字段加载 out/main/index.js
    args: ["."],
    cwd: APPS_DESKTOP,
    env: {
      ...process.env,
      // E2E 可能与本机已运行的 X-agent 实例并存 → 放开单实例锁
      X_AGENT_ALLOW_MULTI: "1",
    },
  });
  // 启动有 splash 窗口；主窗口 URL 为 file://…/renderer/index.html
  const main = await app.waitForEvent("window", {
    predicate: (win) => win.url().includes("renderer/index.html"),
    timeout: 60_000,
  });
  await main.waitForLoadState("domcontentloaded");
  return { app, main };
}
