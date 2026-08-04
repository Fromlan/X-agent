/**
 * Vitest 配置 —— 覆盖 ROADMAP 1.1 里程碑。
 *
 * 当前阶段仅启用 node 环境（主进程核心模块）。后续 E2E 走 Playwright。
 * 命名约定：`*.test.ts` 走 Vitest，`scripts/test-*.ts` 保留为离线断言脚本，
 * `npm run test` 串联两者。
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "electron/**/*.test.ts",
      "shared/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    // 不与现有 tsx 离线脚本冲突；后者命名 test-*.ts 但不被 include。
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      // 门槛仅作用于 ROADMAP 1.1 首批核心模块；后续逐步扩展。
      include: [
        "electron/agent/cwd-sandbox.ts",
        "electron/agent/project-fs.ts",
        "electron/agent/usage-store.ts",
        "electron/agent/shadow-checkpoints.ts",
        "electron/agent/retract-orchestrator.ts",
        "electron/agent/godot-rpc-bridge.ts",
        "shared/godot-rpc.ts",
        "shared/mode-tools.ts",
        "shared/mode-prompt.ts",
      ],
      thresholds: {
        lines: 60,
        functions: 55,
        branches: 50,
        statements: 60,
      },
    },
    // 与 electron-vite 同步别名
    alias: {
      "@shared": new URL("./shared/", import.meta.url).pathname,
      "@/": new URL("./", import.meta.url).pathname,
    },
  },
});
