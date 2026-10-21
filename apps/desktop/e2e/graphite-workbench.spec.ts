/** Exercise the redesigned workbench with saved conversation content and real attachment controls. */
import { test, expect } from "@playwright/test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { launchApp } from "./helpers";

test("restored workbench keeps content, panel navigation and attachment selection usable", async ({}, testInfo) => {
  const directory = mkdtempSync(join(tmpdir(), "x-agent-graphite-"));
  const project = join(directory, "Moonfall");
  mkdirSync(project);
  writeFileSync(join(project, "notes.txt"), "Movement review notes");
  writeFileSync(join(project, "project.godot"), 'config_version=5\n[application]\nconfig/name="Moonfall"\n');
  const { app, main } = await launchApp({ prepare: (home) => {
    const sessions = join(home, ".pi", "agent", "x-agent", "sessions");
    mkdirSync(sessions, { recursive: true });
    const agentDir = join(home, ".pi", "agent");
    writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { "preview-fixture": {
      baseUrl: "https://offline.example", api: "openai-completions", apiKey: "placeholder",
      models: [{ id: "fixture", name: "Preview fixture", reasoning: false, input: ["text"], contextWindow: 200000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    } } }));
    writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ "preview-fixture": { type: "api_key", key: "placeholder" } }));
    for (const [name, daysAgo] of [["设计背包交互", 0], ["排查场景加载错误", 0], ["整理关卡结构", 1]] as const) {
      const history = SessionManager.create(project, sessions);
      history.appendSessionInfo(name);
      const updated = new Date();
      updated.setDate(updated.getDate() - daysAgo);
      // Discovery derives activity from message timestamps, independently of later file touches.
      history.appendMessage({ role: "user", content: name, timestamp: updated.getTime() });
    }
    const session = SessionManager.create(project, sessions);
    session.appendModelChange("preview-fixture", "fixture");
    const usage = { input: 120, output: 80, cacheRead: 0, cacheWrite: 0, totalTokens: 200, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    const timestamp = Date.now();
    const assistant = { api: "openai-completions" as const, provider: "preview-fixture", model: "fixture", usage, timestamp };
    session.appendMessage({ role: "user", content: "优化角色移动，加入跳跃缓冲和土狼时间。", timestamp });
    session.appendMessage({ role: "assistant", content: [
      { type: "text", text: "已检查角色控制脚本。保留现有移动逻辑，新增两个可调参数。" },
      { type: "toolCall", id: "read-player", name: "read", arguments: { path: "scripts/player.gd" } },
      { type: "toolCall", id: "edit-player", name: "edit", arguments: { path: "scripts/player.gd", oldText: "jump()", newText: "buffer_jump()" } },
      { type: "toolCall", id: "check-player", name: "bash", arguments: { command: "git diff --check" } },
    ], ...assistant, stopReason: "toolUse" });
    for (const [id, name, text] of [["read-player", "read", "角色控制逻辑已读取"], ["edit-player", "edit", "角色移动逻辑已更新"], ["check-player", "bash", "脚本检查完成"]]) {
      session.appendMessage({ role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text }], isError: false, timestamp });
    }
    session.appendMessage({ role: "assistant", content: [{ type: "text", text: "已加入 **0.12 秒跳跃缓冲**与 **0.10 秒土狼时间**。可在 Godot 中运行当前场景验证手感。" }], ...assistant, stopReason: "stop" });
    session.appendSessionInfo("优化角色移动与跳跃");
    const planDir = join(agentDir, "x-agent", "plans");
    const refsDir = join(agentDir, "x-agent", "plan-refs");
    mkdirSync(planDir, { recursive: true });
    mkdirSync(refsDir, { recursive: true });
    const planPath = join(planDir, "movement.md");
    writeFileSync(planPath, "# 角色移动优化\n\n- [x] 检查角色控制逻辑\n- [x] 加入缓冲与土狼时间\n- [ ] 在当前场景验证手感\n");
    const sessionPath = session.getSessionFile()!;
    const journalKey = createHash("sha256").update(sessionPath).digest("hex").slice(0, 24);
    writeFileSync(join(refsDir, `${journalKey}.json`), JSON.stringify({ version: 1, sessionPath, planPath, updatedAt: timestamp }));
    writeFileSync(join(home, ".pi", "agent", "x-agent.json"), JSON.stringify({ themeId: "default", colorMode: "dark", rightPanelOpen: true, dismissedReadyChecklistKeys: [] }));
  } });
  try {
    await main.emulateMedia({ reducedMotion: "reduce" });
    const window = await app.browserWindow(main);
    await window.evaluate((window) => { window.webContents.setBackgroundThrottling(false); window.setContentSize(1440, 900); });
    await main.locator('.session-card-main[title="优化角色移动与跳跃"]').click();
    await expect(main.locator(".chat-header h1")).toHaveText("优化角色移动与跳跃");
    await expect(main.locator(".bubble-text").last()).toContainText("0.12 秒跳跃缓冲");
    // Dismiss setup guidance through the real control; keep screenshots focused on the configured workspace.
    const dismissSetup = main.getByRole("button", { name: "不再提醒", exact: true });
    if (await dismissSetup.isVisible()) await dismissSetup.click();
    await expect(main.getByRole("button", { name: "会话模式", exact: true })).toBeEnabled();
    await expect(main.getByRole("button", { name: "模型", exact: true })).toContainText("Preview fixture");
    await main.locator(".bubble-tool-batch > summary").click();
    await expect(main.locator(".toolbatch-body")).toBeVisible();
    await expect(main.locator(".rp-nav-label")).toHaveCount(5);
    await main.locator(".rp-nav").getByRole("button", { name: "文件", exact: true }).click();
    await expect(main.locator(".rp-tree-row").filter({ hasText: "notes.txt" })).toBeVisible();
    await main.locator(".rp-nav").getByRole("button", { name: "计划", exact: true }).click();
    await expect(main.locator(".rp-plan-heading")).toContainText("2 / 3 已完成");
    await expect(main.locator(".topbar button")).toHaveCount(3);
    await expect(main.locator(".sidebar-workspace .sidebar-project-copy")).toContainText("Moonfall");
    await expect(main.locator(".sidebar-version")).toHaveText(/^v\d+\.\d+\.\d+/);
    await expect(main.locator(".session-date-label")).toContainText(["今天", "昨天"]);
    await expect(main.locator(".session-card-main")).toHaveCount(4);
    await expect(main.getByRole("button", { name: "新会话", exact: true })).toBeEnabled();
    await expect(main.locator(".rp-plan-todo-toggle").last()).toBeEnabled();
    await main.mouse.move(600, 70);
    await main.screenshot({ path: testInfo.outputPath("graphite-workbench.png") });
    await main.getByText("查看完整计划", { exact: true }).click();
    await expect(main.getByLabel("计划渲染预览")).toContainText("角色移动优化");
    await main.locator(".rp-plan-view-toggle").click();
    await expect(main.getByRole("textbox", { name: "计划 Markdown", exact: true })).toHaveValue(/角色移动优化/);
    await main.locator(".rp-plan-view-toggle").click();
    await main.locator(".rp-plan-todo-toggle").last().click();
    await expect(main.locator(".rp-plan-heading")).toContainText("3 / 3 已完成");
    await main.locator(".rp-plan-actions").getByRole("button", { name: "保存", exact: true }).click();
    await expect(main.locator(".rp-plan-loc")).not.toContainText("未保存");
    const chooser = main.waitForEvent("filechooser");
    await main.getByRole("button", { name: "添加附件", exact: true }).click();
    await (await chooser).setFiles(join(project, "notes.txt"));
    await expect(main.locator(".composer-attachment-file-name")).toHaveText("notes.txt");
    await expect(main.locator(".composer-send")).toBeEnabled();
    await main.locator(".composer-attachment-remove").click();
    await expect(main.locator(".composer-attachment-file-name")).toHaveCount(0);
    await main.getByLabel("工作区选项", { exact: true }).click();
    await main.getByRole("button", { name: "切换主题", exact: true }).click();
    await expect(main.locator("body")).toHaveAttribute("data-theme", "default-light");
    await expect(main.locator(".composer-send")).toBeInViewport();
    await main.screenshot({ path: testInfo.outputPath("graphite-light.png") });
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
