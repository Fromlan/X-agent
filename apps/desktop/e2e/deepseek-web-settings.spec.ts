/** Exercise real Electron settings and IPC persistence using isolated, nonbillable provider fixtures. */
import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("web tools require a selected official provider and persist independent settings", async ({}, testInfo) => {
  const { app, main, home } = await launchApp({ prepare: (home) => {
    const agentDir = join(home, ".pi", "agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: {
      deepseek: { api: "openai-completions", baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-offline-fixture",
        models: [{ id: "deepseek-flash", name: "Flash fixture", reasoning: false, input: ["text"], contextWindow: 100_000, maxTokens: 1000 }] },
    } }));
    writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ deepseek: { type: "api_key", key: "sk-offline-fixture" } }));
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
    const search = section.getByRole("checkbox", { name: "网页搜索", exact: true });
    const fetch = section.getByRole("checkbox", { name: "链接阅读", exact: true });
    const reminder = section.getByRole("checkbox", { name: "日期与语言信息", exact: true });
    const safety = section.getByRole("checkbox", { name: "内容安全审核", exact: true });
    await expect(reminder).not.toBeChecked();
    await expect(safety).not.toBeChecked();
    await expect.poll(() => main.evaluate(() => window.xAgent.prefs.get())).toMatchObject({
      deepseekLatestReminder: false, deepseekSafetyCheck: false,
    });
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

    // Optional conversation metadata and extra safety review stay off until explicitly enabled.
    expect(await main.evaluate(() => window.xAgent.session.setModel("deepseek", "deepseek-flash"))).toMatchObject({ ok: true });
    await main.locator('[title="设置（Ctrl+,）"]').click();
    await main.locator(".settings-nav").getByRole("button", { name: "工具", exact: true }).click();
    await expect(reminder).toBeEnabled();
    await expect(safety).toBeEnabled();
    await expect(reminder).not.toBeChecked();
    await expect(safety).not.toBeChecked();
    await reminder.click();
    await expect(reminder).toBeChecked();
    await expect.poll(() => main.evaluate(() => window.xAgent.prefs.get())).toMatchObject({
      deepseekLatestReminder: true, deepseekSafetyCheck: false,
    });
    await safety.click();
    await expect(safety).toBeChecked();
    await expect.poll(() => main.evaluate(() => window.xAgent.prefs.get())).toMatchObject({
      deepseekLatestReminder: true, deepseekSafetyCheck: true,
    });
    await main.locator(".settings-nav").getByRole("button", { name: "通用", exact: true }).click();
    await main.locator(".settings-nav").getByRole("button", { name: "工具", exact: true }).click();
    await expect(reminder).toBeChecked();
    await expect(safety).toBeChecked();
    await reminder.click();
    await expect(reminder).not.toBeChecked();
    await expect.poll(() => main.evaluate(() => window.xAgent.prefs.get())).toMatchObject({ deepseekLatestReminder: false });
    await safety.click();
    await expect(safety).not.toBeChecked();
    await expect.poll(() => main.evaluate(() => window.xAgent.prefs.get())).toMatchObject({
      deepseekLatestReminder: false, deepseekSafetyCheck: false,
    });
  } finally { await app.close(); }
});

test("native options support Pi models without GUI profiles and remain disabled for other models", async () => {
  const { app, main, home } = await launchApp({ prepare: (home) => {
    const agentDir = join(home, ".pi", "agent");
    mkdirSync(agentDir, { recursive: true });
    const model = { id: "deepseek-flash", name: "Pi Flash fixture", reasoning: false,
      input: ["text"], contextWindow: 100_000, maxTokens: 1000 };
    writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: {
      "pi-direct": { api: "openai-completions", baseUrl: "https://api.deepseek.com/v1", apiKey: "offline-invalid-key",
        models: [model, { ...model, id: "other-model", name: "Other model fixture" }] },
      "pi-proxy": { api: "openai-completions", baseUrl: "https://proxy.example/v1", apiKey: "offline-invalid-key", models: [model] },
    } }));
    writeFileSync(join(agentDir, "auth.json"), JSON.stringify({
      "pi-direct": { type: "api_key", key: "offline-invalid-key" },
      "pi-proxy": { type: "api_key", key: "offline-invalid-key" },
    }));
    // An existing empty catalog must not import these Pi credentials as GUI profiles.
    writeFileSync(join(agentDir, "x-agent-providers.json"), JSON.stringify({ version: 1, activeId: null, profiles: [] }));
    writeFileSync(join(agentDir, "x-agent.json"), JSON.stringify({ provider: "pi-direct", model: "deepseek-flash",
      rightPanelOpen: false, godotAutoConnect: false }));
    mkdirSync(join(home, "pi-direct-project"));
  } });
  try {
    expect(await main.evaluate((cwd) => window.xAgent.workspace.open(cwd, "new"), join(home, "pi-direct-project")))
      .toMatchObject({ ok: true });
    expect(await main.evaluate(() => window.xAgent.session.setModel("pi-direct", "deepseek-flash")))
      .toMatchObject({ ok: true });
    expect(await main.evaluate(() => window.xAgent.provider.listProfiles())).toEqual([]);
    expect(await main.evaluate(async () => (await window.xAgent.session.listModels())
      .find((model) => model.provider === "pi-direct" && model.id === "deepseek-flash")))
      .toMatchObject({ deepseekChatbot: true });
    await main.keyboard.press("Control+,");
    await main.locator(".settings-nav").getByRole("button", { name: "工具", exact: true }).click();
    const reminder = main.getByRole("checkbox", { name: "日期与语言信息", exact: true });
    const safety = main.getByRole("checkbox", { name: "内容安全审核", exact: true });
    await expect(reminder).toBeEnabled();
    await expect(safety).toBeEnabled();
    await expect(reminder).not.toBeChecked();
    await expect(safety).not.toBeChecked();
    await reminder.click();
    await expect(reminder).toBeChecked();
    await safety.click();
    await expect(safety).toBeChecked();
    await expect.poll(() => main.evaluate(() => window.xAgent.prefs.get())).toMatchObject({
      deepseekLatestReminder: true, deepseekSafetyCheck: true,
    });

    for (const [provider, id] of [["pi-direct", "other-model"], ["pi-proxy", "deepseek-flash"]]) {
      expect(await main.evaluate(({ provider, id }) => window.xAgent.session.setModel(provider, id), { provider, id }))
        .toMatchObject({ ok: true });
      await expect(reminder).toBeDisabled();
      await expect(safety).toBeDisabled();
    }
    expect(await main.evaluate(() => window.xAgent.session.setModel("pi-direct", "deepseek-flash")))
      .toMatchObject({ ok: true });
    await expect(reminder).toBeEnabled();
    await expect(safety).toBeEnabled();
    await expect(reminder).toBeChecked();
    await expect(safety).toBeChecked();
    expect(JSON.parse(readFileSync(join(home, ".pi", "agent", "x-agent.json"), "utf8")))
      .toMatchObject({ deepseekLatestReminder: true, deepseekSafetyCheck: true });
    expect(await main.evaluate(() => window.xAgent.provider.listProfiles())).toEqual([]);
  } finally { await app.close(); }
});
