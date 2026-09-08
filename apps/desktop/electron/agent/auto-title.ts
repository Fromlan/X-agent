/**
 * Auto-title sessions after first round (issue #59 主题 A 提取).
 *
 * Lifted out of SessionHost so the host facade can stay focused on
 * "接 Pi 事件 + 路由到子编排器". Title generation is a one-shot async
 * side-effect that doesn't need direct access to the full host state —
 * it only needs the bundle, the runtime factory, and an emit callback.
 */
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ensureSessionTitle } from "./session-title";
import { extractMessageText } from "../../shared/transcript";
import type { SessionBundle } from "./session-lifecycle";
import type { UiAgentEvent } from "../../shared/ipc";

/**
 * Snapshot deps for one auto-title pass. The host captures these once
 * and passes them into `maybeAutoTitleSession`; the helper never reads
 * `this.*` from the host directly, so it can be tested in isolation.
 */
export interface AutoTitleDeps {
  /** Current bundle (null if no session). */
  getBundle(): SessionBundle | null;
  /** Lazy runtime factory (ModelRuntime may not exist yet). */
  ensureRuntime(): Promise<ModelRuntime>;
  /** Emit events to the renderer. */
  emit(event: UiAgentEvent): void;
  /** Auto-title in-flight flag, accessed via callbacks to avoid races. */
  isInFlight(): boolean;
  setInFlight(v: boolean): void;
}

/**
 * After the first completed round, ensure the open session has a title once.
 * Title is generated via `ensureSessionTitle` which calls back to
 * `runtime.completeSimple` with a short prompt (maxTokens 64, temperature 0.2).
 * Returns silently if no bundle, already in flight, or the session was
 * swapped / named between snapshots.
 */
export async function maybeAutoTitleSession(deps: AutoTitleDeps): Promise<void> {
  const bundle = deps.getBundle();
  if (!bundle || deps.isInFlight()) return;

  const messages = bundle.session.messages as readonly unknown[];
  let userText = "";
  let assistantText = "";
  for (const msg of messages) {
    const role = (msg as { role?: string }).role;
    if (!userText && role === "user") {
      userText = extractMessageText(msg);
    } else if (userText && !assistantText && role === "assistant") {
      assistantText = extractMessageText(msg);
      break;
    }
  }

  deps.setInFlight(true);
  try {
    const decided = await ensureSessionTitle({
      currentName: bundle.session.sessionManager.getSessionName(),
      userText,
      assistantText,
      complete: async (prompt) => {
        const model = bundle.session.model;
        if (!model) return null;
        const runtime = await deps.ensureRuntime();
        if (deps.getBundle() !== bundle) return null;
        if (bundle.session.sessionManager.getSessionName()) return null;
        const result = await runtime.completeSimple(
          model,
          {
            messages: [
              {
                role: "user",
                content: prompt,
                timestamp: Date.now(),
              },
            ],
            tools: [],
          },
          { maxTokens: 64, temperature: 0.2 },
        );
        if (deps.getBundle() !== bundle) return null;
        if (bundle.session.sessionManager.getSessionName()) return null;
        if (result.stopReason === "error" || result.stopReason === "aborted") {
          return null;
        }
        return result.content
          .filter(
            (p): p is { type: "text"; text: string } =>
              !!p &&
              typeof p === "object" &&
              (p as { type?: string }).type === "text" &&
              typeof (p as { text?: unknown }).text === "string",
          )
          .map((p) => p.text)
          .join("")
          .trim();
      },
      isStale: () =>
        deps.getBundle() !== bundle ||
        Boolean(bundle.session.sessionManager.getSessionName()),
    });

    if (!decided || decided.action !== "set") return;
    if (deps.getBundle() !== bundle) return;
    if (bundle.session.sessionManager.getSessionName()) return;

    try {
      bundle.session.setSessionName(decided.title);
      deps.emit({
        type: "session_title",
        sessionId: bundle.session.sessionId,
        name: decided.title,
        sessionPath: bundle.sessionPath,
      });
    } catch {
      // Non-fatal: listSessions still falls back to firstMessage.
    }
  } finally {
    deps.setInFlight(false);
  }
}
