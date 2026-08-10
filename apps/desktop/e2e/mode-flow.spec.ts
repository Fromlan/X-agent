/**
 * E2E 契约 —— 打开临时项目后 Plan 模式被启用 + 状态切换可由用户操作。
 * 这是 mode-switch.spec.ts 的扩展：先打开项目，再确认模式切换 + restore cwd 关闭。
 */
import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test.describe.configure({ mode: "serial" });

test("打开项目后模式药丸 enable/disabled 状态切换", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "xagent-e2e-proj-"));
  const { app, main } = await launchApp();
  try {
    await expect(main.locator('[data-mode="plan"]')).toBeDisabled();

    await main.evaluate(async (cwd) => {
      const res = await window.xAgent.workspace.open(cwd, "new");
      if (!res.ok) throw new Error(res.error ?? "openProject failed");
    }, tmp);

    await expect(main.locator('[data-mode="plan"]')).toBeEnabled();

    // 默认是 agent 模式
    await expect(main.locator('[data-mode="agent"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // 切到 plan
    await main.locator('[data-mode="plan"]').click();
    await expect(main.locator('[data-mode="plan"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(main.locator('[data-mode="agent"]')).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // 切到 ask
    await main.locator('[data-mode="ask"]').click();
    await expect(main.locator('[data-mode="ask"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(main.locator('[data-mode="plan"]')).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // 切换后通过 IPC 读 mode 状态与 UI 一致
    const mode = await main.evaluate(async () => {
      return window.xAgent.session.getMode();
    });
    expect(mode.kind).toBe("ask");
  } finally {
    await main.evaluate(() => window.xAgent.workspace.close()).catch(() => {});
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});
