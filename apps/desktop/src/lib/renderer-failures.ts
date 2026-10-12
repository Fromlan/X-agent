/** Notify main about uncaught renderer failures without sending exception bodies or arbitrary user content. */
import { RENDERER_FAILURE_REASONS, type RendererFailure } from "@shared/diagnostics";
import { inspectError } from "@shared/error-i18n";

/** Classify an async request failure locally; only a bounded category crosses IPC. */
function failureReason(error: unknown): RendererFailure["reason"] {
  const detail = error && typeof error === "object" ? error as { name?: unknown; message?: unknown } : {};
  const name = typeof detail.name === "string" ? detail.name : "unknown";
  const message = typeof detail.message === "string" ? detail.message : typeof error === "string" ? error : "";
  if (name === "AbortError" || name === "APIUserAbortError") return "aborted";
  // Programming exceptions stay fatal; fetch itself uses TypeError for transport failures.
  if (["ReferenceError", "RangeError", "SyntaxError"].includes(name) || (name === "TypeError" && !/^(Failed to fetch|fetch failed|Load failed)\b/i.test(message))) return name as RendererFailure["reason"];
  const pattern = inspectError(`${name}: ${message}`).patternId;
  if (pattern === "aborted") return "aborted";
  if (pattern?.startsWith("network_") || name === "APIConnectionError") return "network";
  return RENDERER_FAILURE_REASONS.find((allowed) => allowed === name) ?? "unknown";
}

/** Keep operational request rejections separate from runtime errors that need fatal recovery. */
export function installRendererFailureHandlers(target: Pick<Window, "addEventListener" | "removeEventListener">, report: (failure: RendererFailure) => Promise<unknown>): () => void {
  let reported = false;
  const handler = (event: Event) => {
    if (reported) return;
    const kind = event.type === "unhandledrejection" ? "rejection" : "error";
    const reason = failureReason(kind === "rejection" ? (event as PromiseRejectionEvent).reason : (event as ErrorEvent).error);
    const recoverable = kind === "rejection" && (reason === "network" || reason === "aborted");
    if (!recoverable) reported = true;
    // Include synchronous report failures in the catch to avoid recursive unhandled rejections.
    void Promise.resolve().then(() => report({ kind, reason })).catch(() => console.error("X-agent 无法记录界面异常，请重新启动"));
  };
  target.addEventListener("error", handler);
  target.addEventListener("unhandledrejection", handler);
  return () => { target.removeEventListener("error", handler); target.removeEventListener("unhandledrejection", handler); };
}
