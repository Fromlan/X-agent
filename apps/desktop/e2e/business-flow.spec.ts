/** Drive the real Electron/Pi tool and retract pipeline with a deterministic offline model adapter. */
import { test, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launchApp } from "./helpers";

const extension = `
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
export default function(pi) {
  pi.registerProvider("offline-e2e", {
    baseUrl: "https://offline.example", apiKey: "placeholder", api: "offline-e2e-api",
    models: [{ id: "fixture", name: "Offline fixture", reasoning: false, input: ["text"], contextWindow: 200000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context) {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const user = context.messages.filter(m => m.role === "user").at(-1);
        const text = typeof user?.content === "string" ? user.content : user?.content?.filter(p => p.type === "text").map(p => p.text).join("") || "";
        const tool = context.messages.at(-1)?.role === "toolResult";
        const content = tool ? [{ type: "text", text: "Verified offline tool execution complete" }] : [{ type: "toolCall", id: "fixture-" + Date.now(), name: text.includes("read") ? "read" : "write", arguments: text.includes("read") ? { path: "managed.txt" } : { path: "managed.txt", content: "agent change" } }];
        const message = { role: "assistant", content, api: model.api, provider: model.provider, model: model.id, stopReason: tool ? "stop" : "toolUse", timestamp: Date.now(), usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        stream.push({ type: "start", partial: message });
        if (tool) stream.push({ type: "text_end", contentIndex: 0, content: content[0].text, partial: message });
        else stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: content[0], partial: message });
        stream.push({ type: "done", reason: message.stopReason, message }); stream.end();
      });
      return stream;
    }
  });
}`;

test("real send, write, retract, resume and long transcript preserve user files", async () => {
  const project = mkdtempSync(join(tmpdir(), "x-agent-business-"));
  mkdirSync(join(project, ".pi", "extensions"), { recursive: true });
  writeFileSync(join(project, ".pi", "extensions", "offline.ts"), extension);
  writeFileSync(join(project, "managed.txt"), "original");
  const { app, main, home } = await launchApp();
  try {
    // Prove all application storage is inside the test home before invoking any mutations.
    const isolated = await app.evaluate(() => process.env.USERPROFILE ?? "");
    expect(isolated.toLowerCase()).toBe(home.toLowerCase());
    const opened = await main.evaluate((cwd) => window.xAgent.workspace.open(cwd, "new"), project);
    expect(opened.ok).toBe(true);
    expect((await main.evaluate(() => window.xAgent.session.setModel("offline-e2e", "fixture"))).ok).toBe(true);
    await main.evaluate(() => window.xAgent.prefs.set({ tools: ["read", "write"], autoCompactPercent: 0 }));
    await main.evaluate(() => {
      (window as unknown as { auditEvents: unknown[] }).auditEvents = [];
      window.xAgent.onEvent((event) => (window as unknown as { auditEvents: unknown[] }).auditEvents.push(event));
    });
    expect((await main.evaluate(() => window.xAgent.turn.prompt({ text: "write fixture" }))).ok).toBe(true);
    await expect.poll(() => readFileSync(join(project, "managed.txt"), "utf8")).toBe("agent change");
    await expect.poll(() => main.evaluate(async () => (await window.xAgent.workspace.getStatus()).status)).toBe("idle");
    writeFileSync(join(project, "user-only.txt"), "keep user edit");
    const entry = await main.evaluate(() => {
      const events = (window as unknown as { auditEvents: { type: string; userEntryId?: string }[] }).auditEvents;
      return events.find((e) => e.type === "assistant_start" && e.userEntryId)?.userEntryId;
    });
    expect(entry).toBeTruthy();
    const preview = await main.evaluate((id) => window.xAgent.turn.previewRetract(id), entry!);
    expect(preview.restorablePaths).toContain("managed.txt");
    expect((await main.evaluate((id) => window.xAgent.turn.retract(id, { undoFiles: true }), entry!)).ok).toBe(true);
    expect(readFileSync(join(project, "managed.txt"), "utf8")).toBe("original");
    expect(readFileSync(join(project, "user-only.txt"), "utf8")).toBe("keep user edit");
    const status = await main.evaluate(() => window.xAgent.workspace.getStatus());
    expect(status.sessionPath).toBeTruthy();
    expect(status.sessionPath!.toLowerCase().startsWith(home.toLowerCase())).toBe(true);
    expect((await main.evaluate((path) => window.xAgent.workspace.resume(path), status.sessionPath!)).ok).toBe(true);
    for (let i = 0; i < 20; i++) {
      expect((await main.evaluate((index) => window.xAgent.turn.prompt({ text: `read fixture ${index}` }), i)).ok).toBe(true);
      await expect.poll(() => main.evaluate(async () => (await window.xAgent.workspace.getStatus()).status)).toBe("idle");
    }
    const snapshot = await main.evaluate(() => window.xAgent.appReport.getDiagnosticSnapshot());
    expect(snapshot.state.sessionActive).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain(project);
    await expect(main.locator(".composer")).toBeVisible();
    expect(readFileSync(join(project, "user-only.txt"), "utf8")).toBe("keep user edit");
  } finally { await app.close(); rmSync(project, { recursive: true, force: true }); }
});

test("settings rejects a persistence failure instead of reporting success", async () => {
  const { app, main, home } = await launchApp();
  try {
    const file = join(home, ".pi", "agent", "x-agent.json");
    writeFileSync(file, "{corrupt");
    const result = await main.evaluate(async () => {
      try { await window.xAgent.prefs.set({ tools: ["read"] }); return "success"; }
      catch { return "rejected"; }
    });
    expect(result).toBe("rejected"); expect(readFileSync(file, "utf8")).toBe("{corrupt");
  } finally { await app.close(); }
});
