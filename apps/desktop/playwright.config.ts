/**
 * Playwright E2E 配置 —— 覆盖 ROADMAP 1.1 里程碑。
 *
 * 面向 Electron 主应用（`_electron.launch`），无需下载浏览器二进制；
 * 要求先 `npm run build` 产出 `out/`，再 `npm run test:e2e`。
 * 首批用例为「应用可启动 + 主界面壳渲染 + 会话模式切换契约」；
 * 完整的「新建会话 → Plan → 撤回 → 切回 Agent」模型链路见 ROADMAP 1.7 契约锁。
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    trace: "retain-on-failure",
  },
});
