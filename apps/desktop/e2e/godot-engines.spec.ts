/** Verify multi-version engine management, project isolation and persisted cleanup through the real settings bridge. */
import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("engine settings retain multiple installations and separate project bindings", async ({}, testInfo) => {
  let first = "";
  let second = "";
  const { app, main, home } = await launchApp({ prepare: (home) => {
    first = join(home, "first-project"); second = join(home, "second-project");
    for (const project of [first, second]) {
      mkdirSync(project);
      writeFileSync(join(project, "project.godot"), 'config_version=5\n[application]\nconfig/name="Engine fixture"\n');
    }
    const agentDir = join(home, ".pi", "agent");
    mkdirSync(agentDir, { recursive: true });
    const legacy = join(home, "Godot46.exe"); const current = join(home, "Godot47.exe");
    writeFileSync(join(agentDir, "x-agent.json"), JSON.stringify({ godotAutoConnect: false,
      godotEditorPath: legacy,
      godotEngines: [{ path: legacy, name: "Godot 4.6", version: "4.6.2.stable" }, { path: current, name: "Godot 4.7", version: "4.7.2.stable" }],
      godotProjectEditors: { [first.replace(/\\/g, "/").toLowerCase()]: legacy, [second.replace(/\\/g, "/").toLowerCase()]: current },
    }));
    writeFileSync(join(agentDir, "x-agent-providers.json"), JSON.stringify({ version: 1, activeId: null, profiles: [{
      id: "offline", name: "Offline", providerId: "deepseek", api: "openai-completions", baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-offline-fixture", models: [{ id: "deepseek-flash" }], enabled: true, updatedAt: new Date().toISOString(),
    }] }));
  } });
  try {
    expect((await main.evaluate((path) => window.xAgent.workspace.open(path, "new", "code"), first)).ok).toBe(true);
    await main.locator('[title="设置（Ctrl+,）"]').click();
    await main.locator(".settings-nav").getByRole("button", { name: "Godot", exact: true }).click();
    await expect(main.locator(".godot-engine-row")).toHaveCount(2);
    await expect(main.getByRole("button", { name: "当前项目 Godot 引擎", exact: true })).toContainText("Godot 4.6");
    await expect(main.getByRole("button", { name: "默认 Godot 引擎", exact: true })).toContainText("Godot 4.6");
    const legacy = main.getByLabel("引擎配置 Godot 4.6", { exact: true });
    await legacy.getByRole("textbox").fill("稳定版引擎");
    await legacy.getByRole("button", { name: "保存名称" }).click();
    await expect(main.getByLabel("引擎配置 稳定版引擎", { exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "默认 Godot 引擎", exact: true })).toContainText("稳定版引擎");
    await main.screenshot({ path: testInfo.outputPath("godot-engine-management.png") });
    await main.keyboard.press("Escape");

    expect((await main.evaluate((path) => window.xAgent.workspace.open(path, "new", "code"), second)).ok).toBe(true);
    await main.locator('[title="设置（Ctrl+,）"]').click();
    await main.locator(".settings-nav").getByRole("button", { name: "Godot", exact: true }).click();
    await expect(main.getByRole("button", { name: "当前项目 Godot 引擎", exact: true })).toContainText("Godot 4.7");
    await main.getByRole("button", { name: "移除引擎 Godot 4.7", exact: true }).click();
    await expect(main.locator(".godot-engine-row")).toHaveCount(1);
    await expect(main.getByRole("button", { name: "当前项目 Godot 引擎", exact: true })).toContainText("使用默认引擎");
    const prefs = await main.evaluate(() => window.xAgent.prefs.get());
    expect(Object.keys(prefs.godotProjectEditors)).toHaveLength(1);
    expect(prefs.godotEditorPath).toBe(join(home, "Godot46.exe"));
    await main.getByRole("button", { name: "默认 Godot 引擎", exact: true }).click();
    await main.getByRole("option", { name: "自动检测", exact: true }).click();
    await expect(main.getByRole("button", { name: "默认 Godot 引擎", exact: true })).toHaveText("自动检测");
    const persisted = JSON.parse(readFileSync(join(home, ".pi", "agent", "x-agent.json"), "utf8"));
    expect(persisted.godotEditorPath).toBeNull();
    expect(persisted.godotEngines).toEqual([{ path: join(home, "Godot46.exe"), name: "稳定版引擎", version: "4.6.2.stable" }]);
    await main.screenshot({ path: testInfo.outputPath("godot-engine-project-binding.png") });
  } finally { await app.close(); }
});
