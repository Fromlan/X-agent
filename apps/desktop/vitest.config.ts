/**
 * Vitest 配置 —— 覆盖 ROADMAP 1.1 里程碑。
 *
 * node 环境（主进程核心模块 + 纯逻辑 renderer lib 测试）。
 * 命名约定：`*.test.ts` 走 Vitest，`scripts/test-*.ts` 为离线断言脚本，
 * `npm run test` 串联两者（0.4.0 起不再双重覆盖：cwd-sandbox / usage-store /
 * godot-rpc-bridge / shadow-checkpoints 已由 Vitest 独占）。
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "electron/**/*.test.ts",
      "shared/**/*.test.ts",
      "src/**/*.test.ts",
    ],
    // 跳过 React 组件渲染测试 —— vitest 跑的是 node 环境, 没有 jsdom.
    // ComposerAttachments.test.tsx 留在仓库作为手测脚手架; 核心逻辑 (file
    // → ImageContent, 4 张 / 4MB / mimeType 校验) 由 src/lib/file-attachment.test.ts
    // 覆盖.
    exclude: [
      "src/components/ComposerAttachments.test.tsx",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      // 门槛仅作用于首批核心模块；后续逐步扩展。
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
