/**
 * E2E 会话模式契约 —— 打开临时项目后，模式药丸由禁用变可用，
 * 点击「计划」激活 aria-pressed，切回「智能体」还原。
 * 通过 `window.xAgent.openProject()` 绕过原生目录对话框，主进程
 * `session_info` 事件会同步 renderer 的 cwd 状态。
 */
import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test.describe.configure({ mode: "serial" });

test("打开项目后可在 Plan / Agent 间切换会话模式", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "x-agent-e2e-proj-"));
  const { app, main } = await launchApp();
  try {
    await expect(main.locator('[data-mode="plan"]')).toBeDisabled();

    await main.evaluate(async (cwd) => {
      const res = await window.xAgent.openProject(cwd, "new");
      if (!res.ok) throw new Error(res.error ?? "openProject failed");
    }, tmp);

    // openProject 成功 → 主进程 session_info 事件同步 cwd → 药丸可用
    await expect(main.locator('[data-mode="plan"]')).toBeEnabled();

    await main.locator('[data-mode="plan"]').click();
    await expect(main.locator('[data-mode="plan"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(main.locator('[data-mode="agent"]')).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await main.locator('[data-mode="agent"]').click();
    await expect(main.locator('[data-mode="agent"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(main.locator('[data-mode="plan"]')).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  } finally {
    await main.evaluate(() => window.xAgent.closeWorkspace()).catch(() => {});
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});
