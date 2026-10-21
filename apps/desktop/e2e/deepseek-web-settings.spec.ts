/** Exercise real Electron settings and IPC persistence using isolated, nonbillable provider fixtures. */
import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("web tools require a selected official provider and persist independent settings", async ({}, testInfo) => {
  const { app, main, home } = await launchApp({ prepare: (home) => {
    const agentDir = join(home, ".pi", "agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "x-agent-providers.json"), JSON.stringify({ version: 1, activeId: null, profiles: [
      { id: "official-web", name: "DeepSeek 网络测试", providerId: "deepseek", api: "openai-completions", baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-offline-fixture", models: [{ id: "deepseek-flash" }], enabled: true, updatedAt: new Date().toISOString() },
      { id: "unrelated", name: "其他供应商", providerId: "custom", api: "openai-completions", baseUrl: "https://proxy.example/v1",
        apiKey: "sk-other-fixture", models: [{ id: "fixture" }], enabled: true, updatedAt: new Date().toISOString() },
      { id: "missing-key", name: "DeepSeek 无密钥", providerId: "deepseek", api: "openai-completions", baseUrl: "https://api.deepseek.com",
        apiKey: "", models: [{ id: "deepseek-flash" }], enabled: true, updatedAt: new Date().toISOString() },
    ] }));
  } });
  try {
    await main.locator('[title="设置（Ctrl+,）"]').click();
    await main.locator(".settings-nav").getByRole("button", { name: "工具", exact: true }).click();
    const section = main.locator(".settings-block").filter({ has: main.getByRole("heading", { name: "DeepSeek 网络", exact: true }) });
    const search = section.getByRole("checkbox", { name: "网页搜索（web_search）" });
    const fetch = section.getByRole("checkbox", { name: "网页抓取（web_fetch）" });
    await expect(search).not.toBeChecked();
    await expect(search).toBeDisabled();
    await section.getByRole("button", { name: "DeepSeek 网络供应商" }).click();
    await expect(main.getByRole("option", { name: "其他供应商" })).toHaveCount(0);
    await expect(main.getByRole("option", { name: "DeepSeek 无密钥（缺少密钥）" })).toBeDisabled();
    await main.getByRole("option", { name: "DeepSeek 网络测试", exact: true }).click();
    await expect(search).toBeEnabled();
    await search.click();
    await expect(search).toBeChecked();
    await expect.poll(() => main.evaluate(() => window.xAgent.prefs.get())).toMatchObject({ deepseekWebProviderId: "official-web", tools: expect.arrayContaining(["web_search"]) });
    await fetch.click();
    await expect(fetch).toBeChecked();
    await expect.poll(() => main.evaluate(() => window.xAgent.prefs.get())).toMatchObject({ tools: expect.arrayContaining(["web_search", "web_fetch"]) });
    const persisted = JSON.parse(readFileSync(join(home, ".pi", "agent", "x-agent.json"), "utf8"));
    expect(persisted.deepseekWebProviderId).toBe("official-web");
    expect(persisted).not.toHaveProperty("apiKey");
    await main.screenshot({ path: testInfo.outputPath("deepseek-web-settings.png") });
    await main.locator(".settings-nav").getByRole("button", { name: "通用", exact: true }).click();
    await main.locator(".settings-nav").getByRole("button", { name: "工具", exact: true }).click();
    await expect(search).toBeChecked();
    await expect(fetch).toBeChecked();
    await fetch.click();
    await expect(fetch).not.toBeChecked();
    await expect.poll(() => main.evaluate(async () => (await window.xAgent.prefs.get()).tools)).not.toContain("web_fetch");

    // Real Pi session registration must retain custom tools across readonly modes and hot changes.
    await main.keyboard.press("Escape");
    const project = join(home, "web-project");
    mkdirSync(project);
    expect((await main.evaluate((cwd) => window.xAgent.workspace.open(cwd, "new", "code"), project)).ok).toBe(true);
    for (const mode of ["agent", "ask", "plan"] as const) {
      expect((await main.evaluate((mode) => window.xAgent.plan.setMode(mode), mode)).ok).toBe(true);
      const active = await main.evaluate(() => window.xAgent.plan.getMode());
      expect(active.tools).toContain("web_search");
      expect(active.tools).not.toContain("web_fetch");
      if (mode !== "agent") expect(active.tools).not.toContain("write");
    }
    await main.evaluate(async () => {
      const current = await window.xAgent.prefs.get();
      await window.xAgent.prefs.set({ tools: [...current.tools, "web_fetch"] });
    });
    expect((await main.evaluate(() => window.xAgent.plan.getMode())).tools).toContain("web_fetch");
    expect((await main.evaluate((cwd) => window.xAgent.workspace.open(cwd, "new", "design"), project)).ok).toBe(true);
    expect((await main.evaluate(() => window.xAgent.plan.getMode())).tools).toEqual(expect.arrayContaining(["web_search", "web_fetch"]));
  } finally { await app.close(); }
});
