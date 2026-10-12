/** Trace approved IPC and agent operations with anonymous IDs, never their arguments or results. */
import { randomUUID } from "node:crypto";
import { DIAGNOSTIC_OPERATIONS, type DiagnosticOperation, type DiagnosticOutcome } from "../../shared/diagnostics";
import type { UiAgentEvent } from "../../shared/ipc";
import { SESSION_TOOL_REGISTRY } from "../../shared/tools/derived";
import { diagnosticReason, diagnosticTracingEnabled, recordDiagnostic } from "./diagnostics";

const IPC_OPERATIONS = new Set<string>(DIAGNOSTIC_OPERATIONS);
const TOOLS = new Set<string>([...SESSION_TOOL_REGISTRY, "godot_detect_project"]);
type Completion = ((outcome: Exclude<DiagnosticOutcome, "started">, error?: unknown) => void) & { operationId: string };

/** Persist a start immediately so a hung or crashed operation remains visible after restart. */
export function startDiagnosticOperation(operation: DiagnosticOperation, tool?: string, parentOperationId?: string): Completion {
  const operationId = randomUUID();
  const startedAt = performance.now();
  const metadata = { operation, operationId, parentOperationId, ...(tool ? { tool: TOOLS.has(tool) ? tool : "extension" } : {}) };
  let completed = false;
  recordDiagnostic("operation", "none", { ...metadata, outcome: "started" });
  const complete = (outcome: Exclude<DiagnosticOutcome, "started">, error?: unknown): void => {
    if (completed) return;
    completed = true;
    recordDiagnostic("operation", outcome === "failed" ? diagnosticReason(error) : outcome === "canceled" ? "aborted" : "none", {
      ...metadata, outcome, durationMs: Math.max(0, performance.now() - startedAt),
    });
  };
  return Object.assign(complete, { operationId });
}

/** Recognize expected cancellations and handled Result failures without exporting their contents. */
export function diagnosticResultOutcome(result: unknown): Exclude<DiagnosticOutcome, "started"> {
  if (!result || typeof result !== "object") return "succeeded";
  const value = result as { ok?: unknown; canceled?: unknown; silent?: unknown; error?: unknown };
  if (value.canceled === true || value.error === "已取消" || (value.ok === false && value.silent === true)) return "canceled";
  return value.ok === false || (typeof value.error === "string" && value.error.length > 0) ? "failed" : "succeeded";
}

/** Ignore polling; completion receives only the result's error category, never the result payload. */
export function traceDiagnosticIpc(channel: string): { resolved(result: unknown): void; rejected(error: unknown): void } | null {
  if (!diagnosticTracingEnabled() || !IPC_OPERATIONS.has(channel)) return null;
  const complete = startDiagnosticOperation(channel as DiagnosticOperation);
  return {
    resolved(result) { complete(diagnosticResultOutcome(result), (result as { error?: unknown } | null)?.error); },
    rejected(error) { complete(diagnosticReason(error) === "aborted" ? "canceled" : "failed", error); },
  };
}

/** Observe one host's asynchronous failures; streaming text and tool payloads are deliberately ignored. */
export function createAgentDiagnosticRecorder(): (event: UiAgentEvent) => void {
  let agent: Completion | null = null;
  let compaction: Completion | null = null;
  let retry: Completion | null = null;
  let sessionId: string | null = null;
  let lastRecordedError: string | undefined;
  const tools = new Map<string, Completion>();
  return (event) => {
    if (!diagnosticTracingEnabled()) return;
    switch (event.type) {
      case "session_info":
        if (sessionId !== event.sessionId) {
          agent?.("canceled"); compaction?.("canceled"); retry?.("canceled");
          for (const complete of tools.values()) complete("canceled");
          tools.clear(); agent = compaction = retry = null;
          sessionId = event.sessionId;
          lastRecordedError = undefined;
        }
        break;
      case "agent_start":
        agent?.("canceled");
        for (const complete of tools.values()) complete("canceled");
        tools.clear(); lastRecordedError = undefined;
        agent = startDiagnosticOperation("agent");
        break;
      case "assistant_end":
        if (event.isError || event.aborted) {
          (agent ?? startDiagnosticOperation("agent"))(event.aborted ? "canceled" : "failed", event.errorMessage);
          agent = null;
          lastRecordedError = event.errorMessage;
        }
        break;
      case "status":
        if (event.status === "error" && event.error && event.error !== lastRecordedError) {
          (agent ?? startDiagnosticOperation("agent"))("failed", event.error);
          agent = null; lastRecordedError = event.error;
        }
        break;
      case "agent_end":
        if (!event.willRetry) { agent?.("succeeded"); agent = null; }
        break;
      case "tool_start":
        // Bound in-memory correlation even if an extension emits unmatched starts.
        if (tools.size >= 100) {
          for (const complete of tools.values()) complete("canceled");
          tools.clear();
        }
        tools.get(event.toolCallId)?.("canceled");
        tools.set(event.toolCallId, startDiagnosticOperation("tool", event.toolName, agent?.operationId));
        break;
      case "tool_end":
        (tools.get(event.toolCallId) ?? startDiagnosticOperation("tool", event.toolName))(event.isError ? "failed" : "succeeded", "tool-error");
        tools.delete(event.toolCallId);
        break;
      case "compaction_start":
        compaction?.("canceled"); compaction = startDiagnosticOperation("compaction", undefined, agent?.operationId);
        break;
      case "compaction_end":
        compaction?.(event.errorMessage ? "failed" : event.aborted ? "canceled" : "succeeded", event.errorMessage);
        compaction = null;
        break;
      case "auto_retry":
        if (event.phase === "start") { retry?.("canceled"); retry = startDiagnosticOperation("retry", undefined, agent?.operationId); }
        else { retry?.(event.success ? "succeeded" : "failed", event.message); retry = null; }
        break;
    }
  };
}
