/** Verify startup configures a real Git Bash before restoring a project, without a manual readiness action. */
import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findSuggestedBash } from "../electron/agent/bash-check";
import { launchApp } from "./helpers";

for (const initial of ["missing", "invalid", "configured"] as const) {
  test(`Bash startup setup: ${initial} configuration needs no manual action`, async () => {
    const bash = await findSuggestedBash();
    expect(bash, "Git for Windows must be installed for the real Bash startup regression").toBeTruthy();
    let project = "";
    const { app, main, home } = await launchApp({ prepare: (home) => {
      const agent = join(home, ".pi", "agent");
      mkdirSync(agent, { recursive: true });
      project = join(home, "project");
      mkdirSync(project);
      writeFileSync(join(agent, "settings.json"), JSON.stringify({
        preserved: "keep", packages: [],
        ...(initial === "configured" ? { shellPath: bash } : initial === "invalid" ? { shellPath: join(home, "removed-bash.exe") } : {}),
      }));
      writeFileSync(join(agent, "x-agent.json"), JSON.stringify({ lastProjectPath: project, provider: "deepseek", model: "deepseek-flash" }));
      writeFileSync(join(agent, "x-agent-providers.json"), JSON.stringify({ version: 1, activeId: null, profiles: [{
        id: "offline", name: "Offline fixture", providerId: "deepseek", api: "openai-completions", baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-offline-fixture", models: [{ id: "deepseek-flash" }], enabled: true, updatedAt: new Date().toISOString(),
      }] }));
    } });
    try {
      // A visible main window means renderer bootstrap, including last-project restoration, has finished.
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(
        (win) => win.webContents.getURL().includes("renderer/index.html") && win.isVisible(),
      ))).toBe(true);
      const status = await main.evaluate(() => window.xAgent.prefs.checkBash());
      expect(status).toMatchObject({ ok: true, shellPath: bash });
      expect(status.message).not.toContain("可写入");
      expect(JSON.parse(readFileSync(join(home, ".pi", "agent", "settings.json"), "utf8"))).toMatchObject({ shellPath: bash, preserved: "keep" });
      const session = await main.evaluate(() => window.xAgent.workspace.getStatus());
      expect(session.cwd).toBe(project);
      expect(session.sessionId).toBeTruthy();
      await expect(main.getByText(/^(配置终端 \(bash\)|写入 bash shellPath|写入 shellPath)$/)).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
}
