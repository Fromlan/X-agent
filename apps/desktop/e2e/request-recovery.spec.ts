/** Exercise real Pi error/abort streams through the composer and verify a subsequent send succeeds. */
import { test, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launchApp } from "./helpers";

const extension = `
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
export default function(pi) {
  pi.registerProvider("request-fixture", {
    baseUrl: "https://offline.example", apiKey: "placeholder", api: "request-fixture-api",
    models: [{ id: "fixture", name: "Request fixture", reasoning: false, input: ["text"], contextWindow: 200000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const user = context.messages.filter(m => m.role === "user").at(-1);
      const text = typeof user?.content === "string" ? user.content : user?.content?.filter(p => p.type === "text").map(p => p.text).join("") || "";
      const message = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, stopReason: "stop", timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const finish = (error, aborted = false) => {
        if (error) {
          message.stopReason = aborted ? "aborted" : "error"; message.errorMessage = error;
          stream.push({ type: "error", reason: message.stopReason, error: message });
        } else {
          message.content = [{ type: "text", text: "Request recovered successfully" }];
          stream.push({ type: "text_end", contentIndex: 0, content: message.content[0].text, partial: message });
          stream.push({ type: "done", reason: "stop", message });
        }
        stream.end();
      };
      queueMicrotask(() => {
        stream.push({ type: "start", partial: message });
        if (text.includes("cancel fixture")) {
          if (options?.signal?.aborted) finish("Request was aborted.", true);
          else options?.signal?.addEventListener("abort", () => finish("Request was aborted.", true), { once: true });
        } else finish(text.includes("connection fixture") ? "Connection error." : undefined);
      });
      return stream;
    }
  });
}`;

test("connection error and user cancellation preserve the session and allow retry", async () => {
  const project = mkdtempSync(join(tmpdir(), "x-agent-request-recovery-"));
  mkdirSync(join(project, ".pi", "extensions"), { recursive: true });
  writeFileSync(join(project, ".pi", "extensions", "request-fixture.ts"), extension);
  const { app, main } = await launchApp({ prepare: (home) => {
    const agentDir = join(home, ".pi", "agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false } }));
  } });
  try {
    expect((await main.evaluate((cwd) => window.xAgent.workspace.open(cwd, "new"), project)).ok).toBe(true);
    expect((await main.evaluate(() => window.xAgent.session.setModel("request-fixture", "fixture"))).ok).toBe(true);
    await main.evaluate(() => window.xAgent.prefs.set({ autoCompactPercent: 0 }));
    await main.locator(".composer textarea").fill("connection fixture");
    await main.locator(".composer-send").click();
    await expect(main.getByText("Connection error.", { exact: true })).toBeVisible();
    await expect(main.getByText("网络异常：与供应商的连接中断", { exact: true }).first()).toBeVisible();
    await expect.poll(() => main.evaluate(async () => (await window.xAgent.workspace.getStatus()).status)).toBe("idle");

    await main.locator(".composer textarea").fill("cancel fixture");
    await main.locator(".composer-send").click();
    await main.getByRole("button", { name: "中止", exact: true }).click();
    await expect(main.getByText("Request was aborted.", { exact: true })).toBeVisible();
    await expect.poll(() => main.evaluate(async () => (await window.xAgent.workspace.getStatus()).status)).toBe("idle");

    await main.locator(".composer textarea").fill("retry fixture");
    await main.locator(".composer-send").click();
    await expect(main.getByText("Request recovered successfully", { exact: true })).toBeVisible();
    const snapshot = await main.evaluate(() => window.xAgent.appReport.getDiagnosticSnapshot());
    expect(snapshot.state.sessionActive).toBe(true);
    expect(snapshot.events).toEqual([]);
  } finally { await app.close(); rmSync(project, { recursive: true, force: true }); }
});
