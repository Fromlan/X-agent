/** Persist bounded allowlisted operation metadata and failure-time state for local support reports. */
import { mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { release } from "node:os";
import { EventEmitter } from "node:events";
import {
  DIAGNOSTIC_OPERATIONS, RENDERER_FAILURE_REASONS,
  type RendererFailure, type DiagnosticEvent, type DiagnosticKind,
  type DiagnosticSnapshot, type DiagnosticState,
} from "../../shared/diagnostics";
import { ERROR_PATTERN_IDS, inspectError } from "../../shared/error-i18n";
import { SESSION_TOOL_REGISTRY } from "../../shared/tools/derived";
import { getAgentDirPath } from "../agent/prefs";
import { writeJsonAtomicSync } from "../agent/lib/atomic-write";

const RUN_ID = randomUUID();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APP_VERSION = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]{1,60})?$/;
const REASONS = new Set<string>([...RENDERER_FAILURE_REASONS, ...ERROR_PATTERN_IDS, "crashed", "killed", "oom", "abnormal-exit", "launch-failed", "integrity-failure", "clean-exit", "none", "tool-error"]);
const KINDS = new Set<string>(["main-exception", "main-rejection", "renderer-gone", "renderer-error", "renderer-rejection", "child-gone", "operation"]);
const OPERATIONS = new Set<string>([...DIAGNOSTIC_OPERATIONS, "agent", "tool", "compaction", "retry"]);
const TOOLS = new Set<string>([...SESSION_TOOL_REGISTRY, "godot_detect_project", "extension"]);
const OUTCOMES = new Set<string>(["started", "succeeded", "failed", "canceled"]);
let stateProvider: (() => DiagnosticState) | null = null;
let currentAppVersion: string | undefined;

/** Inject a main-process projection; no renderer payloads or paths are accepted as context. */
export function configureDiagnosticState(provider: (() => DiagnosticState) | null, appVersion?: string): void {
  stateProvider = provider;
  currentAppVersion = provider && appVersion && APP_VERSION.test(appVersion) ? appVersion : undefined;
}

/** Business tracing starts only after the application wires its live state projection. */
export function diagnosticTracingEnabled(): boolean { return stateProvider !== null; }

/** Narrow state even when a caller or persisted file supplies extra fields or arbitrary strings. */
function safeState(value: unknown): DiagnosticState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const state = value as Record<string, unknown>;
  return {
    status: typeof state.status === "string" && ["idle", "streaming", "retrying", "error"].includes(state.status) ? state.status : "unknown",
    mode: typeof state.mode === "string" && ["agent", "ask", "plan", "goal"].includes(state.mode) ? state.mode : "unknown",
    sessionActive: state.sessionActive === true,
    godotClients: typeof state.godotClients === "number" && Number.isSafeInteger(state.godotClients) && state.godotClients >= 0 ? state.godotClients : 0,
  };
}

/** Capture before recovery changes live state; diagnostics must not interrupt recovery. */
function currentState(): DiagnosticState | undefined {
  try { return safeState(stateProvider?.()); }
  catch { return undefined; }
}

/** Accept only enum metadata from IPC; missing/invalid reports retain fatal recovery behavior. */
export function normalizeRendererFailure(value: unknown): RendererFailure {
  const report = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const reason = RENDERER_FAILURE_REASONS.find((allowed) => allowed === report.reason) ?? "unknown";
  return { kind: report.kind === "rejection" ? "rejection" : "error", reason };
}

/** Return the private metadata file without ever reading authentication or conversation files. */
export function diagnosticPath(): string { return join(getAgentDirPath(), "x-agent", "diagnostics", "events.json"); }

/** Keep the latest failure separately so successful operations cannot evict its restart evidence. */
function failurePath(): string { return join(getAgentDirPath(), "x-agent", "diagnostics", "last-failure.json"); }

/** Reconstruct every exported field; never forward persisted records as arbitrary objects. */
function safeEvent(value: unknown): DiagnosticEvent | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.at !== "number" || !Number.isFinite(record.at) || record.at < 0 || typeof record.kind !== "string" || !KINDS.has(record.kind) || typeof record.reason !== "string" || !REASONS.has(record.reason)) return null;
  const event: DiagnosticEvent = { at: record.at, kind: record.kind as DiagnosticKind, reason: String(record.reason) };
  for (const key of ["runId", "operationId", "parentOperationId"] as const) {
    if (typeof record[key] === "string" && UUID.test(record[key])) event[key] = record[key];
  }
  if (typeof record.operation === "string" && OPERATIONS.has(record.operation)) event.operation = record.operation as DiagnosticEvent["operation"];
  if (typeof record.outcome === "string" && OUTCOMES.has(record.outcome)) event.outcome = record.outcome as DiagnosticEvent["outcome"];
  if (record.kind === "operation" && (!event.operation || !event.outcome || !event.operationId)) return null;
  if (typeof record.durationMs === "number" && Number.isFinite(record.durationMs) && record.durationMs >= 0) event.durationMs = Math.round(record.durationMs);
  if (typeof record.tool === "string" && TOOLS.has(record.tool)) event.tool = record.tool;
  if (typeof record.appVersion === "string" && APP_VERSION.test(record.appVersion)) event.appVersion = record.appVersion;
  const state = safeState(record.state);
  if (state) event.state = state;
  return event;
}

/** Preserve legacy crash records while limiting the exported timeline and filtering invalid records. */
export function readDiagnosticEvents(): DiagnosticEvent[] {
  try {
    const value = JSON.parse(readFileSync(diagnosticPath(), "utf8")) as unknown;
    if (!Array.isArray(value)) return [];
    return value.slice(-100).map(safeEvent).filter((event): event is DiagnosticEvent => event !== null);
  } catch { return []; }
}

/** Treat user cancellation as an outcome, not an unresolved failure. */
function isFailure(event: DiagnosticEvent): boolean {
  return event.kind === "operation" ? event.outcome === "failed"
    : event.reason !== "clean-exit" && !(event.kind === "renderer-rejection" && event.reason === "aborted");
}

/** Recover retained failures; older installations fall back to the crash timeline. */
function readLastFailure(events: DiagnosticEvent[]): DiagnosticEvent | null {
  let retained: DiagnosticEvent | null = null;
  try { retained = safeEvent(JSON.parse(readFileSync(failurePath(), "utf8"))); } catch { /* No retained record on older installs. */ }
  if (retained && !isFailure(retained)) retained = null;
  const latest = events.findLast(isFailure) ?? null;
  return latest && (!retained || latest.at >= retained.at) ? latest : retained;
}

/** Classify errors in memory and persist only registry categories, never messages or stacks. */
export function diagnosticReason(error: unknown): string {
  try {
    const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    if (REASONS.has(raw)) return raw;
    const category = inspectError(raw).patternId;
    if (category) return category;
    const name = error instanceof Error ? error.name : raw;
    return REASONS.has(name) ? name : "unknown";
  } catch { return "unknown"; }
}

/** Append safe events atomically; support-storage failures must not change business behavior. */
export function recordDiagnostic(kind: DiagnosticKind, reason: unknown, metadata: Partial<DiagnosticEvent> = {}): void {
  try {
    const event = safeEvent({ ...metadata, at: Date.now(), kind, reason: diagnosticReason(reason), runId: RUN_ID, state: currentState(), appVersion: currentAppVersion });
    if (!event) return;
    mkdirSync(join(getAgentDirPath(), "x-agent", "diagnostics"), { recursive: true });
    // Preserve failure evidence first, even if the rolling timeline cannot be written afterward.
    if (isFailure(event)) writeJsonAtomicSync(failurePath(), event);
    writeJsonAtomicSync(diagnosticPath(), [...readDiagnosticEvents(), event].slice(-100));
  } catch { console.error("[diagnostics] Unable to persist local support metadata"); }
}

/** Install fatal process handlers; continuing after an unknown exception is never considered recovery. */
export function installProcessDiagnostics(emitter: EventEmitter, onFatal: () => void): () => void {
  let exiting = false;
  const fatal = (kind: DiagnosticKind, error: unknown) => {
    recordDiagnostic(kind, error);
    if (!exiting) { exiting = true; onFatal(); }
  };
  const exception = (error: unknown) => fatal("main-exception", error);
  const rejection = (error: unknown) => fatal("main-rejection", error);
  emitter.on("uncaughtException", exception); emitter.on("unhandledRejection", rejection);
  return () => { emitter.removeListener("uncaughtException", exception); emitter.removeListener("unhandledRejection", rejection); };
}

/** Export current state alongside failure-time evidence with an anonymous application-run report ID. */
export function diagnosticSnapshot(appVersion: string, state: DiagnosticSnapshot["state"]): DiagnosticSnapshot {
  const memory = process.memoryUsage();
  const events = readDiagnosticEvents();
  return { version: 2, reportId: RUN_ID, generatedAt: Date.now(), appVersion, nodeVersion: process.versions.node, electronVersion: process.versions.electron ?? "none",
    platform: process.platform, architecture: process.arch, osRelease: release(), memory: { rss: memory.rss, heapUsed: memory.heapUsed },
    state: safeState(state)!, lastFailure: readLastFailure(events), events };
}
