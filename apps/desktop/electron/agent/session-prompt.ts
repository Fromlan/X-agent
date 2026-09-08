/**
 * `SessionHost.prompt()` orchestration (issue #3 主题 E 提取).
 *
 * Lifted out of SessionHost so the host facade stays focused on
 * "接 Pi 事件 + 路由到子编排器". The prompt pipeline is a discrete
 * state machine (guard → reset retry counter → resolve slash / extension
 * → wrap prompt template → steer-vs-fresh turn → bundle-switch detect →
 * error path) that can live here as a free function and be unit-tested
 * with a mock host, no real AgentSession / Pi SDK / electron needed.
 */
import { dbgLog, dbgTimer } from "../../shared/debug-log";
import type {
  AgentStatus,
  NoticeReplaceKey,
  PromptPayload,
  PromptResult,
} from "../../shared/ipc";
import { TRUNCATION_RECOVERY_MARKER } from "./truncation-recovery";
import { wrapPromptSlashAsBlock } from "./prompt-slash-wrap";
import type { SessionBundle } from "./session-lifecycle";

/**
 * Snapshot deps for the prompt pipeline. The host captures these once and
 * passes them into the helper; the helper never reads `this.*`.
 *
 * Kept narrower than `CwdLock`: prompt is a public IPC method (not a
 * sub-orchestrator) so it doesn't need the full CwdLock surface — only
 * the bundle accessor + status / preparing flag mutators + the shadow
 * checkpoint pre-step + the truncation retry counter reset.
 */
export interface SessionPromptHost {
  getBundle(): SessionBundle | null;
  setStatus(status: AgentStatus, error?: string): void;
  /** Read the prepare→prompt transition flag (retract orchestrator uses this). */
  isPreparing(): boolean;
  setPreparing(v: boolean): void;
  /** Prepare the shadow-git checkpoint before a fresh turn. */
  prepareShadowCheckpoint(): Promise<void>;
  /**
   * Reset the consecutive-truncation retry counter. Called on every
   * user-typed prompt (recovery prompts carry the marker and skip reset).
   */
  resetTruncationRetries(): void;
}

/**
 * Run the `session.prompt` orchestration. Mirrors the original in-line
 * pipeline from SessionHost.prompt() but with the bundle / status /
 * shadow-checkpoint plumbing injected through `host`.
 *
 * Returns `{ok:false, error}` for guard failures (no bundle / empty input)
 * and bundle-switch races; never throws — the catch maps to
 * `{ok:false, error}` and a `setStatus("error", msg)` for the renderer.
 */
export async function runSessionPrompt(
  host: SessionPromptHost,
  payload: PromptPayload,
): Promise<PromptResult> {
  const bundle = host.getBundle();
  if (!bundle) {
    dbgLog("session", "prompt rejected: no bundle");
    return { ok: false, error: "尚未打开项目" };
  }
  const text = (payload?.text ?? "").trim();
  const images = payload?.images;
  if (!text && (!images || images.length === 0)) {
    dbgLog("session", "prompt rejected: empty text and no images");
    return { ok: false, error: "消息不能为空" };
  }
  // User-typed prompt → reset truncation retry counter. Recovery prompts
  // (system-injected via notifyTruncation) carry the marker; everything
  // else (including extension commands) is treated as user input.
  if (!text.startsWith(TRUNCATION_RECOVERY_MARKER)) {
    host.resetTruncationRetries();
  }

  dbgLog("session", "prompt start", {
    len: text.length,
    preview: text.slice(0, 80),
    imageCount: images?.length ?? 0,
    isStreaming: bundle.session.isStreaming,
  });
  const doneShadow = dbgTimer("session", "preparePromptCheckpoint");
  const donePi = dbgTimer("session", "session.prompt");
  const doneAll = dbgTimer("session", "total prompt");

  try {
    const { session } = bundle;
    const slashName = text.startsWith("/")
      ? (text.match(/^\/([^\s]+)/)?.[1] ?? "")
      : "";
    const isExtensionCommand =
      Boolean(slashName) &&
      !slashName.startsWith("skill:") &&
      Boolean(session.extensionRunner.getCommand(slashName));

    // Wrap prompt templates as `<prompt>` so the UI can chip them
    // (Pi already wraps `/skill:name` as `<skill>`).
    let sendText = text;
    if (!isExtensionCommand) {
      const wrapped = wrapPromptSlashAsBlock(text, [
        ...session.promptTemplates,
      ]);
      if (wrapped) sendText = wrapped;
    }

    if (session.isStreaming) {
      dbgLog("session", "prompt: steer into active stream");
      await session.prompt(sendText, { streamingBehavior: "steer", images });
      donePi();
    } else {
      dbgLog("session", "prompt: prepare shadow checkpoint…");
      // 进入 prepare→prompt 过渡窗口:期间拒绝撤回(见 RetractOrchestrator)。
      // 标志在 prepare 结束后立即释放(此后同步进入 session.prompt,
      // streaming 为 true,撤回走 abort 路径)。
      host.setPreparing(true);
      try {
        await host.prepareShadowCheckpoint();
      } finally {
        host.setPreparing(false);
      }
      doneShadow();
      if (host.getBundle() !== bundle) {
        dbgLog("session", "prompt aborted: bundle switched during shadow");
        return { ok: false, error: "会话已切换" };
      }
      await session.prompt(sendText, { images });
      donePi();
    }
    if (host.getBundle() !== bundle) {
      dbgLog("session", "prompt aborted: bundle switched after pi");
      return { ok: false, error: "会话已切换" };
    }
    doneAll();
    return isExtensionCommand ? { ok: true, silent: true } : { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dbgLog("session", "prompt threw", message);
    if (host.getBundle() === bundle) {
      host.setStatus("error", message);
    }
    return { ok: false, error: message };
  }
}
