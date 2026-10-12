/** Verify copied feedback carries the same report and failure identifiers as its exported bundle. */
import { expect, it } from "vitest";
import { diagnosticEventSummary, diagnosticFeedbackSummary } from "./diagnostic-feedback";
import type { DiagnosticSnapshot } from "./diagnostics";

it("includes failure-time state and anonymous identifiers in a bounded feedback summary", () => {
  const failure = { at: 1, kind: "operation" as const, reason: "network_timeout", operation: "prompt" as const, outcome: "failed" as const,
    operationId: "operation-id", runId: "previous-run", durationMs: 8000, state: { status: "streaming", mode: "plan", sessionActive: true, godotClients: 1 } };
  const report: DiagnosticSnapshot = { version: 2, reportId: "current-report", generatedAt: 2, appVersion: "0.6.6", nodeVersion: "24", electronVersion: "43",
    platform: "win32", architecture: "x64", osRelease: "10.0", memory: { rss: 1, heapUsed: 1 },
    state: { status: "idle", mode: "agent", sessionActive: false, godotClients: 0 }, lastFailure: failure,
    events: Array.from({ length: 100 }, () => failure) };
  const summary = diagnosticFeedbackSummary(report);
  expect(summary).toContain("报告编号：current-report");
  expect(summary).toContain("失败运行编号：previous-run；操作编号：operation-id");
  expect(summary).toContain("失败时状态：streaming；模式：plan");
  expect(summary.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(10);
  expect(diagnosticEventSummary(failure)).toBe("prompt · 失败 · network_timeout · 8000 ms");
});
