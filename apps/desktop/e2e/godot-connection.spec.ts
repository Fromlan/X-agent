/** Exercise project-scoped Godot status events, passive attachment and the automatic-connection preference through Electron. */
import { test, expect } from "@playwright/test";
import { createConnection, type Socket } from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("Godot attaches automatically and never reports another project's editor as connected", async ({}, testInfo) => {
  let project = "";
  let other = "";
  const { app, main, home } = await launchApp({ prepare: (home) => {
    project = join(home, "godot-project");
    other = join(home, "other-project");
    for (const path of [project, other]) {
      mkdirSync(path);
      writeFileSync(join(path, "project.godot"), 'config_version=5\n[application]\nconfig/name="Connection fixture"\n');
    }
    const agentDir = join(home, ".pi", "agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "x-agent-providers.json"), JSON.stringify({ version: 1, activeId: null, profiles: [{
      id: "offline", name: "Offline fixture", providerId: "deepseek", api: "openai-completions", baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-offline-fixture", models: [{ id: "deepseek-flash" }], enabled: true, updatedAt: new Date().toISOString(),
    }] }));
  } });
  let socket: Socket | undefined;
  try {
    const endpointPath = join(home, ".pi", "agent", "x-agent-godot-rpc.json");
    await expect.poll(() => existsSync(endpointPath)).toBe(true);
    const endpoint = JSON.parse(readFileSync(endpointPath, "utf8")) as { port: number; token: string };
    socket = createConnection({ host: "127.0.0.1", port: endpoint.port });
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines.filter(Boolean)) {
        const request = JSON.parse(line) as { id: string };
        socket!.write(`${JSON.stringify({ id: request.id, ok: true, result: "pong" })}\n`);
      }
    });
    await new Promise<void>((resolve, reject) => { socket!.once("connect", resolve); socket!.once("error", reject); });
    socket.write(`${JSON.stringify({ type: "editor_ready", projectPath: project, godotVersion: "4.6.2", token: endpoint.token })}\n`);
    await expect.poll(() => main.evaluate(async () => (await window.xAgent.godot.status()).authenticatedClients)).toBe(1);
    const beforeTools = await main.evaluate(async () => (await window.xAgent.prefs.get()).tools);
    expect((await main.evaluate((cwd) => window.xAgent.workspace.open(cwd, "new", "code"), project)).ok).toBe(true);
    await expect(main.locator(".chat-header-connection")).toHaveText("Godot 已连接");
    expect(await main.evaluate(async () => (await window.xAgent.prefs.get()).tools)).toEqual(beforeTools);
    expect(existsSync(join(project, "addons"))).toBe(false);

    await main.locator('[title="设置（Ctrl+,）"]').click();
    await main.locator(".settings-nav").getByRole("button", { name: "Godot", exact: true }).click();
    const automatic = main.getByRole("checkbox", { name: "打开项目时自动连接 Godot" });
    await expect(automatic).toBeChecked();
    await automatic.click();
    await expect(automatic).not.toBeChecked();
    expect(JSON.parse(readFileSync(join(home, ".pi", "agent", "x-agent.json"), "utf8")).godotAutoConnect).toBe(false);
    await main.screenshot({ path: testInfo.outputPath("godot-auto-connect-settings.png") });
    await main.keyboard.press("Escape");

    expect((await main.evaluate((cwd) => window.xAgent.workspace.open(cwd, "new", "code"), other)).ok).toBe(true);
    await expect(main.locator(".chat-header-connection")).toHaveText("Godot 未连接");
    const state = await main.evaluate(() => window.xAgent.godot.status());
    expect(state.authenticatedClients).toBe(1);
    expect(state.connection?.phase).toBe("disabled");
    expect(existsSync(join(other, "addons"))).toBe(false);
  } finally {
    socket?.destroy();
    await app.close();
  }
});
