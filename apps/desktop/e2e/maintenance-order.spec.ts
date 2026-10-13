/** Exercise real Electron/Pi settlement and snip-first maintenance using an offline provider and supplied summary. */
import { test, expect } from "@playwright/test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";
import type { UiAgentEvent } from "../shared/ipc";

type Metric = { type: string; chars?: number; snipped?: boolean; count?: number; reason?: string };

const extension = `
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
export default function(pi) {
  /** Record actual SDK extension callbacks inside this disposable project only. */
  function record(ctx, metric) { appendFileSync(join(ctx.cwd, "maintenance-metrics.jsonl"), JSON.stringify(metric) + "\\n"); }
  /** Measure all text blocks without assuming Pi always emits one block. */
  function text(message) { return typeof message.content === "string" ? message.content : (message.content || []).filter(part => part.type === "text").map(part => part.text).join(""); }
  pi.on("message_end", (event, ctx) => {
    if (event.message.role === "toolResult") record(ctx, { type: "tool_result", chars: text(event.message).length });
  });
  pi.on("agent_end", (_event, ctx) => record(ctx, { type: "agent_end" }));
  pi.on("agent_settled", (_event, ctx) => record(ctx, { type: "agent_settled" }));
  pi.on("session_before_compact", async (event, ctx) => {
    const tools = [...event.preparation.messagesToSummarize, ...event.preparation.turnPrefixMessages].filter(message => message.role === "toolResult");
    record(ctx, { type: "summary", count: tools.length, chars: tools.reduce((sum, message) => sum + text(message).length, 0), snipped: tools.length > 0 && tools.every(message => text(message).includes("tool result middle pruned")), reason: event.reason });
    // The test releases this live compact lifecycle after probing the real IPC guards.
    const deadline = Date.now() + 15000;
    while (!existsSync(join(ctx.cwd, "release-summary"))) {
      if (event.signal.aborted || Date.now() > deadline) throw new Error("Offline summary release timed out or was aborted");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return { compaction: { summary: "Offline fixture summary: large.txt was read and maintenance verified.", firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: event.preparation.tokensBefore, usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, details: { offlineFixture: true } } };
  });
  pi.on("session_compact", (_event, ctx) => record(ctx, { type: "summary_complete" }));
  pi.registerProvider("maintenance-fixture", {
    baseUrl: "https://offline.example", apiKey: "placeholder", api: "maintenance-fixture-api",
    models: [{ id: "fixture", name: "Offline maintenance fixture", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context) {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const user = context.messages.filter(message => message.role === "user").at(-1);
        const prompt = user ? text(user) : "";
        const fixtureRequest = prompt.includes("pressure read fixture");
        const afterTool = fixtureRequest && context.messages.at(-1)?.role === "toolResult";
        const content = !fixtureRequest ? [{ type: "text", text: "Maintenance fixture" }] : afterTool ? [{ type: "text", text: "Offline maintenance read complete" }] : [{ type: "toolCall", id: "read-large-" + Date.now(), name: "read", arguments: { path: "large.txt" } }];
        const input = afterTool ? (prompt.includes("high-pressure") ? 28800 : 8000) : 20;
        const message = { role: "assistant", content, api: model.api, provider: model.provider, model: model.id, stopReason: fixtureRequest && !afterTool ? "toolUse" : "stop", timestamp: Date.now(), usage: { input, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: input + 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        stream.push({ type: "start", partial: message });
        if (message.stopReason === "toolUse") stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: content[0], partial: message });
        else stream.push({ type: "text_end", contentIndex: 0, content: content[0].text, partial: message });
        stream.push({ type: "done", reason: message.stopReason, message }); stream.end();
      });
      return stream;
    }
  });
}`;

/** Read callbacks emitted by the live SDK instead of inventing a simulated settlement trace. */
function metrics(project: string): Metric[] {
  const path = join(project, "maintenance-metrics.jsonl");
  return existsSync(path) ? readFileSync(path, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Metric) : [];
}

for (const pressure of ["high", "low"] as const) {
  test(`10 real Pi ${pressure} pressure settlement preserves snip-first order and frontend compaction`, async () => {
    const project = mkdtempSync(join(tmpdir(), "x-agent-maintenance-e2e-"));
    mkdirSync(join(project, ".pi", "extensions"), { recursive: true });
    writeFileSync(join(project, ".pi", "extensions", "maintenance-fixture.ts"), extension);
    writeFileSync(join(project, "large.txt"), "fixture-content-".repeat(1250));
    const { app, main, home } = await launchApp({ prepare: (directory) => {
      const agentDir = join(directory, ".pi", "agent");
      mkdirSync(agentDir, { recursive: true });
      // Isolate Pi's own automatic compaction; the app's main and frontend paths remain enabled.
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false, reserveTokens: 500, keepRecentTokens: 0 } }));
    } });
    try {
      expect((await app.evaluate(() => process.env.USERPROFILE ?? "")).toLowerCase()).toBe(home.toLowerCase());
      expect((await main.evaluate((cwd) => window.xAgent.workspace.open(cwd, "new"), project)).ok).toBe(true);
      expect((await main.evaluate(() => window.xAgent.session.setModel("maintenance-fixture", "fixture"))).ok).toBe(true);
      await main.evaluate(() => window.xAgent.prefs.set({ tools: ["read"], autoCompactPercent: 80, autoSnipThreshold: 256, autoSnipHeadKeep: 100, autoSnipTailKeep: 50 }));
      await main.evaluate(() => {
        (window as unknown as { maintenanceEvents: UiAgentEvent[] }).maintenanceEvents = [];
        window.xAgent.onEvent((event) => (window as unknown as { maintenanceEvents: UiAgentEvent[] }).maintenanceEvents.push(event));
      });
      await expect(main.locator(".composer textarea")).toBeEnabled();
      await main.locator(".composer textarea").fill(`${pressure}-pressure read fixture`);
      await main.locator(".composer-send").click();
      await expect.poll(() => metrics(project).filter((event) => event.type === "agent_settled").length).toBe(1);
      if (pressure === "high") {
        await expect.poll(() => metrics(project).filter((event) => event.type === "summary").length).toBe(1);
        expect((await main.evaluate(() => window.xAgent.workspace.getStatus())).status).toBe("streaming");
        await expect(main.locator(".composer-send")).toBeDisabled();
        expect(await main.evaluate(() => window.xAgent.turn.prompt({ text: "request during maintenance" }))).toMatchObject({ ok: false });
        expect(await main.evaluate(() => window.xAgent.session.compactSession())).toMatchObject({ ok: false });
        writeFileSync(join(project, "release-summary"), "release");
      }
      await expect.poll(() => main.evaluate(async () => (await window.xAgent.workspace.getStatus()).status)).toBe("idle");
      await expect(main.locator(".bubble-text").filter({ hasText: "Offline maintenance read complete" }).last()).toBeVisible();
      // Flush React effects after idle; frontend auto-compact remains enabled throughout this test.
      await main.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const recorded = metrics(project);
      expect(recorded.find((event) => event.type === "tool_result")?.chars).toBeGreaterThanOrEqual(20_000);
      const events = await main.evaluate(() => (window as unknown as { maintenanceEvents: UiAgentEvent[] }).maintenanceEvents);
      const evidence = test.info().outputPath("maintenance-evidence.json");
      writeFileSync(evidence, JSON.stringify({ recorded, events }, null, 2));
      await test.info().attach("maintenance-evidence", { path: evidence, contentType: "application/json" });
      const starts = events.filter((event) => event.type === "compaction_start");
      if (pressure === "high") {
        const summaries = recorded.filter((event) => event.type === "summary");
        expect(summaries).toHaveLength(1);
        expect(summaries[0]).toMatchObject({ reason: "manual", snipped: true, count: 1 });
        expect(summaries[0].chars).toBeLessThan(1_000);
        expect(recorded.filter((event) => event.type === "summary_complete")).toHaveLength(1);
        expect(recorded.findIndex((event) => event.type === "agent_settled")).toBeLessThan(recorded.findIndex((event) => event.type === "summary"));
        expect(starts).toHaveLength(1);
        const compactEnd = events.findIndex((event) => event.type === "compaction_end");
        const idle = events.findIndex((event) => event.type === "status" && event.status === "idle");
        expect(compactEnd).toBeGreaterThan(events.findIndex((event) => event.type === "compaction_start"));
        expect(idle).toBeGreaterThan(compactEnd);
        expect(events.slice(compactEnd + 1, idle).some((event) => event.type === "usage_update")).toBe(true);
      } else {
        expect(recorded.some((event) => event.type === "summary")).toBe(false);
        expect(starts).toHaveLength(0);
        const sessionPath = (await main.evaluate(() => window.xAgent.workspace.getStatus())).sessionPath;
        expect(sessionPath).toBeTruthy();
        const entries = readFileSync(sessionPath!, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line) as { type: string; message?: { role: string; content: { type: string; text?: string }[] } });
        const read = entries.find((entry) => entry.type === "message" && entry.message?.role === "toolResult");
        expect(read?.message?.content.map((block) => block.text ?? "").join("")).not.toContain("tool result middle pruned");
      }
      expect(readFileSync(join(project, "large.txt"), "utf8").length).toBe(20_000);
    } finally {
      await app.close();
      rmSync(project, { recursive: true, force: true });
    }
  });
}
