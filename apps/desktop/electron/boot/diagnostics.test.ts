/** Test fatal callbacks, privacy allowlists and bounded disk records in isolated directories. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setAgentDirOverrideForTests } from "../agent/prefs";
import { configureDiagnosticState, diagnosticPath, diagnosticSnapshot, installProcessDiagnostics, normalizeRendererFailure, recordDiagnostic } from "./diagnostics";
import { randomUUID } from "node:crypto";
import { createAgentDiagnosticRecorder, startDiagnosticOperation, traceDiagnosticIpc } from "./diagnostic-operations";
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "x-agent-diagnostics-")); setAgentDirOverrideForTests(dir); });
afterEach(() => { configureDiagnosticState(null); setAgentDirOverrideForTests(null); rmSync(dir, { recursive: true, force: true }); });
it("records fatal metadata once and never writes the exception message or stack", () => {
  const emitter = new EventEmitter(); const fatal = vi.fn();
  const dispose = installProcessDiagnostics(emitter, fatal);
  emitter.emit("uncaughtException", new TypeError("placeholder-secret and private project source"));
  emitter.emit("unhandledRejection", "user prompt with credentials");
  expect(fatal).toHaveBeenCalledTimes(1);
  const file = readFileSync(diagnosticPath(), "utf8");
  expect(file).toContain("TypeError"); expect(file).not.toContain("secret"); expect(file).not.toContain("prompt");
  dispose(); expect(emitter.listenerCount("unhandledRejection")).toBe(0);
});

it("retains failure-time state after restart and after the bounded timeline rolls over", () => {
  const failedState = { status: "streaming", mode: "plan", sessionActive: true, godotClients: 2 };
  configureDiagnosticState(() => failedState, "0.6.5");
  const complete = startDiagnosticOperation("prompt");
  complete("failed", new Error("ETIMEDOUT private prompt and secret"));
  // Rewire the projection as on a later startup; no in-memory failure object is required.
  configureDiagnosticState(() => ({ status: "idle", mode: "agent", sessionActive: false, godotClients: 0 }));
  for (let index = 0; index < 60; index++) startDiagnosticOperation("setPrefs")("succeeded");
  const snapshot = diagnosticSnapshot("0.6.6", { status: "idle", mode: "agent", sessionActive: false, godotClients: 0 });
  expect(snapshot.version).toBe(2);
  expect(snapshot.events).toHaveLength(100);
  expect(snapshot.events.every((event) => event.operation === "setPrefs")).toBe(true);
  expect(snapshot.lastFailure).toMatchObject({ operation: "prompt", outcome: "failed", reason: "network_timeout", state: failedState, appVersion: "0.6.5" });
  expect(snapshot.state.status).toBe("idle");
  expect(JSON.stringify(snapshot)).not.toMatch(/private|secret/);
});

it("drops forged identifiers, custom tool names and nested private state on export", () => {
  recordDiagnostic("renderer-gone", "crashed");
  writeFileSync(diagnosticPath(), JSON.stringify([{
    at: 10, kind: "operation", reason: "unknown", operation: "tool", outcome: "failed", operationId: randomUUID(),
    runId: "private project", tool: "private extension name", durationMs: -1,
    state: { status: "private source", mode: "private key", sessionActive: true, godotClients: Infinity, cwd: dir, prompt: "private prompt" },
    apiKey: "private credentials", result: "private result",
  }, { at: 11, kind: "operation", reason: "unknown", operation: "private operation", outcome: "failed", operationId: randomUUID() }]));
  const snapshot = diagnosticSnapshot("0.6.6", { status: "idle", mode: "agent", sessionActive: false, godotClients: 0 });
  expect(snapshot.events).toHaveLength(1);
  expect(snapshot.events[0]?.state).toEqual({ status: "unknown", mode: "unknown", sessionActive: true, godotClients: 0 });
  expect(JSON.stringify(snapshot)).not.toContain("private");
  expect(JSON.stringify(snapshot)).not.toContain(dir);
});

it("classifies handled failures and cancellations without exporting request or result payloads", () => {
  configureDiagnosticState(() => ({ status: "idle", mode: "agent", sessionActive: true, godotClients: 0 }));
  expect(traceDiagnosticIpc("getStatus")).toBeNull();
  expect(traceDiagnosticIpc("getDiagnosticSnapshot")).toBeNull();
  traceDiagnosticIpc("godotRpcStart")!.resolved({ running: false, error: "ETIMEDOUT private bridge" });
  traceDiagnosticIpc("fetchProviderModels")!.resolved({ ok: false, error: "429 private API response", models: ["private model"] });
  const failure = diagnosticSnapshot("0.6.6", { status: "idle", mode: "agent", sessionActive: true, godotClients: 0 }).lastFailure;
  expect(failure).toMatchObject({ outcome: "failed", reason: "rate_limit" });
  traceDiagnosticIpc("openProject")!.resolved({ ok: false, error: "已取消" });
  traceDiagnosticIpc("prompt")!.rejected(new Error("Request was aborted."));
  traceDiagnosticIpc("prompt")!.rejected(undefined);
  const snapshot = diagnosticSnapshot("0.6.6", { status: "idle", mode: "agent", sessionActive: true, godotClients: 0 });
  expect(snapshot.events.filter((event) => event.outcome === "canceled")).toHaveLength(2);
  expect(snapshot.events.at(-1)).toMatchObject({ outcome: "failed", reason: "unknown" });
  expect(JSON.stringify(snapshot)).not.toContain("private");
});

it("correlates concurrent operations with unique IDs and completes each only once", () => {
  const first = startDiagnosticOperation("prompt");
  const second = startDiagnosticOperation("setPrefs");
  second("succeeded"); first("failed", "unknown"); first("succeeded");
  const events = diagnosticSnapshot("0.6.6", { status: "idle", mode: "agent", sessionActive: true, godotClients: 0 }).events;
  expect(events).toHaveLength(4);
  expect(events[0]?.operationId).toBe(events[3]?.operationId);
  expect(events[1]?.operationId).toBe(events[2]?.operationId);
  expect(events[0]?.operationId).not.toBe(events[1]?.operationId);
  expect(events[3]?.durationMs).toBeGreaterThanOrEqual(0);
});

it("records asynchronous tool and model failures while ignoring streaming and tool content", () => {
  configureDiagnosticState(() => ({ status: "streaming", mode: "agent", sessionActive: true, godotClients: 1 }));
  const record = createAgentDiagnosticRecorder();
  record({ type: "agent_start" });
  record({ type: "text_delta", messageId: "private id", delta: "private source and prompt" });
  record({ type: "tool_start", toolCallId: "private id", toolName: "private extension", args: { password: "private secret" } });
  record({ type: "tool_end", toolCallId: "private id", toolName: "private extension", result: "private result", isError: true });
  record({ type: "assistant_end", messageId: "private id", isError: true, errorMessage: "ETIMEDOUT private error" });
  record({ type: "agent_end", willRetry: false });
  const snapshot = diagnosticSnapshot("0.6.6", { status: "idle", mode: "agent", sessionActive: true, godotClients: 1 });
  expect(snapshot.events.find((event) => event.operation === "tool" && event.outcome === "failed")).toMatchObject({ tool: "extension", reason: "tool-error" });
  expect(snapshot.events.find((event) => event.operation === "tool")?.parentOperationId).toBe(snapshot.events[0]?.operationId);
  expect(snapshot.lastFailure).toMatchObject({ operation: "agent", reason: "network_timeout", state: { status: "streaming" } });
  expect(JSON.stringify(snapshot)).not.toContain("private");
});

it("records status-only failures and treats assistant aborts as cancellations", () => {
  const state = { status: "streaming", mode: "agent", sessionActive: true, godotClients: 0 };
  configureDiagnosticState(() => state);
  const record = createAgentDiagnosticRecorder();
  record({ type: "agent_start" });
  record({ type: "status", status: "error", error: "checkpoint write failed" });
  record({ type: "status", status: "error", error: "checkpoint write failed" });
  record({ type: "agent_start" });
  record({ type: "assistant_end", messageId: "private message", aborted: true });
  record({ type: "agent_end" });
  const snapshot = diagnosticSnapshot("0.6.6", state);
  expect(snapshot.events.filter((event) => event.outcome === "failed")).toHaveLength(1);
  expect(snapshot.events.at(-1)).toMatchObject({ outcome: "canceled" });
  expect(snapshot.lastFailure).toMatchObject({ outcome: "failed" });
});

it("records compaction and retry results and cancels outstanding operations when sessions change", () => {
  const state = { status: "retrying", mode: "goal", sessionActive: true, godotClients: 0 };
  configureDiagnosticState(() => state);
  const record = createAgentDiagnosticRecorder();
  record({ type: "agent_start" });
  record({ type: "compaction_start", reason: "manual" });
  record({ type: "compaction_end", reason: "manual", aborted: false, errorMessage: "ETIMEDOUT private compaction" });
  record({ type: "auto_retry", phase: "start", attempt: 1 });
  record({ type: "auto_retry", phase: "end", attempt: 1, success: false, message: "429 private retry" });
  record({ type: "tool_start", toolCallId: "private tool id", toolName: "read", args: "private args" });
  record({ type: "session_info", sessionId: "private session", cwd: dir, model: null, thinkingLevel: "off", availableThinkingLevels: [] });
  const snapshot = diagnosticSnapshot("0.6.6", state);
  expect(snapshot.events.some((event) => event.operation === "compaction" && event.outcome === "failed" && event.reason === "network_timeout")).toBe(true);
  expect(snapshot.events.some((event) => event.operation === "retry" && event.outcome === "failed" && event.reason === "rate_limit")).toBe(true);
  expect(snapshot.events.at(-1)).toMatchObject({ operation: "tool", outcome: "canceled" });
  expect(JSON.stringify(snapshot)).not.toContain("private");
});

it("contains unavailable state projections and unwritable diagnostic storage", () => {
  configureDiagnosticState(() => { throw new Error("private state"); });
  writeFileSync(join(dir, "x-agent"), "not a directory");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(() => startDiagnosticOperation("prompt")("failed", new Error("private error"))).not.toThrow();
    expect(log).toHaveBeenCalled();
  } finally { log.mockRestore(); }
});
it("drops arbitrary fields and corrupt/untrusted records on export", () => {
  recordDiagnostic("renderer-gone", "crashed");
  writeFileSync(diagnosticPath(), JSON.stringify([{ at: 1, kind: "renderer-gone", reason: "crashed", apiKey: "placeholder" }, { at: 2, kind: "main-exception", reason: "private source text" }]));
  const snapshot = diagnosticSnapshot("0.6.5", { status: "idle", mode: "agent", sessionActive: false, godotClients: 0 });
  expect(snapshot.events).toEqual([{ at: 1, kind: "renderer-gone", reason: "crashed" }]);
  expect(JSON.stringify(snapshot)).not.toContain(dir); expect(JSON.stringify(snapshot)).not.toContain("placeholder");
});

it("accepts only renderer failure enums and exports async categories without raw error bodies", () => {
  expect(normalizeRendererFailure({ kind: "rejection", reason: "network", message: "private source" })).toEqual({ kind: "rejection", reason: "network" });
  expect(normalizeRendererFailure({ kind: "other", reason: "private API key" })).toEqual({ kind: "error", reason: "unknown" });
  expect(normalizeRendererFailure(undefined)).toEqual({ kind: "error", reason: "unknown" });
  recordDiagnostic("renderer-rejection", "network"); recordDiagnostic("renderer-rejection", "aborted");
  const text = JSON.stringify(diagnosticSnapshot("0.6.6", { status: "idle", mode: "agent", sessionActive: true, godotClients: 1 }));
  expect(text).toContain("renderer-rejection"); expect(text).toContain("network"); expect(text).toContain("aborted");
  expect(text).not.toContain("private");
});
