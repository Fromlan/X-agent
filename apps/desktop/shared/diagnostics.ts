/** Allowlisted support contracts correlate failures without collecting user content or credentials. */
import type { IpcChannelKey } from "./ipc-channels";

/** Only user-initiated operations are traced; polling and diagnostic reads never fill the timeline. */
export const DIAGNOSTIC_OPERATIONS = [
  "openProject", "closeWorkspace", "newSession", "resumeSession", "prompt", "abort",
  "retractToUserMessage", "editAndResend", "regenerateFromUser", "setModel", "setSessionMode",
  "compactSession", "reloadResources", "setGoal", "pauseGoal", "resumeGoal", "setPrefs",
  "applyBashShellPath", "checkBashLiveness", "fetchProviderModels", "upsertProviderProfile",
  "setProviderProfileEnabled", "installPackage", "uninstallPackage", "installGodotPiPackage",
  "godotRpcStart", "godotRpcStop", "godotRpcPing", "godotRpcRequest", "launchGodotEditor",
  "installGodotRpcAddon", "checkForUpdates", "downloadUpdate", "installUpdate",
] as const satisfies readonly IpcChannelKey[];
export type DiagnosticOperation = typeof DIAGNOSTIC_OPERATIONS[number] | "agent" | "tool" | "compaction" | "retry";
export type DiagnosticOutcome = "started" | "succeeded" | "failed" | "canceled";
export type DiagnosticKind = "main-exception" | "main-rejection" | "renderer-gone" | "renderer-error" | "renderer-rejection" | "child-gone" | "operation";
export const RENDERER_FAILURE_REASONS = ["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "unknown", "network", "aborted"] as const;
export type RendererFailure = {
  kind: "error" | "rejection";
  reason: typeof RENDERER_FAILURE_REASONS[number];
};
export type DiagnosticState = {
  status: string; mode: string; sessionActive: boolean; godotClients: number;
};
export type DiagnosticEvent = {
  at: number; kind: DiagnosticKind; reason: string;
  runId?: string; operationId?: string; parentOperationId?: string; operation?: DiagnosticOperation;
  outcome?: DiagnosticOutcome; durationMs?: number; tool?: string;
  state?: DiagnosticState;
  appVersion?: string;
};
export type DiagnosticSnapshot = {
  version: 2; reportId: string; generatedAt: number;
  appVersion: string; nodeVersion: string; electronVersion: string;
  platform: string; architecture: string; osRelease: string;
  memory: { rss: number; heapUsed: number };
  state: DiagnosticState;
  lastFailure: DiagnosticEvent | null;
  events: DiagnosticEvent[];
};
export type DiagnosticExportResult = { ok: boolean; path?: string; canceled?: boolean; snapshot?: DiagnosticSnapshot };
