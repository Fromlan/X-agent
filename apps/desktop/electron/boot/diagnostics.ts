/** Persist only enumerated crash metadata so exported support files cannot contain prompts, source or secrets. */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { release } from "node:os";
import { EventEmitter } from "node:events";
import type { DiagnosticEvent, DiagnosticKind, DiagnosticSnapshot } from "../../shared/diagnostics";
import { getAgentDirPath } from "../agent/prefs";
import { writeJsonAtomicSync } from "../agent/lib/atomic-write";

const REASONS = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "unknown", "crashed", "killed", "oom", "abnormal-exit", "launch-failed", "integrity-failure", "clean-exit"]);
const KINDS = new Set<DiagnosticKind>(["main-exception", "main-rejection", "renderer-gone", "renderer-error", "child-gone"]);

/** Return the private metadata file without ever reading authentication or conversation files. */
export function diagnosticPath(): string { return join(getAgentDirPath(), "x-agent", "diagnostics", "events.json"); }

/** Revalidate persisted events through an allowlist; even a tampered file cannot export arbitrary text. */
export function readDiagnosticEvents(): DiagnosticEvent[] {
  try {
    const value = JSON.parse(readFileSync(diagnosticPath(), "utf8")) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((e): e is DiagnosticEvent => !!e && typeof e === "object" && Number.isFinite(e.at) && KINDS.has(e.kind) && REASONS.has(e.reason))
      .slice(-100).map((e) => ({ at: e.at, kind: e.kind, reason: e.reason }));
  } catch { return []; }
}

/** Record bounded safe metadata; storage failure must not hide a fatal process error. */
export function recordDiagnostic(kind: DiagnosticKind, reason: unknown): void {
  const candidate = reason instanceof Error ? reason.name : typeof reason === "string" ? reason : "unknown";
  const event: DiagnosticEvent = { at: Date.now(), kind, reason: REASONS.has(candidate) ? candidate : "unknown" };
  try {
    const dir = join(getAgentDirPath(), "x-agent", "diagnostics");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeJsonAtomicSync(diagnosticPath(), [...readDiagnosticEvents(), event].slice(-100));
  } catch { console.error("[diagnostics] Unable to persist local crash metadata"); }
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

/** Assemble an explicit system/status allowlist, excluding raw logs, errors and identifiers. */
export function diagnosticSnapshot(appVersion: string, state: DiagnosticSnapshot["state"]): DiagnosticSnapshot {
  const memory = process.memoryUsage();
  return { version: 1, appVersion, nodeVersion: process.versions.node, electronVersion: process.versions.electron ?? "none",
    platform: process.platform, architecture: process.arch, osRelease: release(), memory: { rss: memory.rss, heapUsed: memory.heapUsed },
    state: { status: state.status, mode: state.mode, sessionActive: state.sessionActive, godotClients: state.godotClients }, events: readDiagnosticEvents() };
}
