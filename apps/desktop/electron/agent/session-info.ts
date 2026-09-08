/**
 * Session info: getStatus + listModels (issue #59 主题 A 提取).
 *
 * Lifted out of SessionHost so the host facade stays focused on
 * "接 Pi 事件 + 路由到子编排器". These are read-only state projections
 * that can live here as free functions and be unit-tested without
 * standing up the full SessionHost.
 */
import { getCachedPrefs } from "./prefs";
import {
  dedupeModelInfosForUi,
  filterModelsByCatalogEnabled,
} from "./provider-store";
import { modelFromSession } from "./session-host-helpers";
import type {
  HostStatus,
  ModelInfo,
  ThinkingLevel,
} from "../../shared/ipc";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AgentStatus } from "../../shared/ipc";

/** Snapshot deps for status / model listing. */
export interface SessionInfoDeps {
  getStatus(): AgentStatus;
  getBundle(): { session: AgentSession; cwd: string; sessionPath: string | null } | null;
  getLastError(): string | undefined;
  ensureRuntime(): Promise<ModelRuntime>;
}

/** Get the host status snapshot for IPC. */
export function getStatus(deps: SessionInfoDeps): HostStatus {
  const bundle = deps.getBundle();
  return {
    status: deps.getStatus(),
    cwd: bundle?.cwd ?? null,
    sessionId: bundle?.session.sessionId ?? null,
    sessionPath: bundle?.sessionPath ?? null,
    model: bundle ? modelFromSession(bundle.session) : null,
    thinkingLevel:
      (bundle?.session.thinkingLevel as ThinkingLevel | undefined) ??
      getCachedPrefs().thinkingLevel,
    availableThinkingLevels: bundle
      ? bundle.session.getAvailableThinkingLevels()
      : undefined,
    error: deps.getLastError(),
    hasSession: Boolean(bundle),
  };
}

/** List models visible to the user, with catalog filter + dedup. */
export async function listModels(
  deps: SessionInfoDeps,
): Promise<ModelInfo[]> {
  const runtime = await deps.ensureRuntime();
  const available = await runtime.getAvailable();
  const prefs = getCachedPrefs();
  const mapped = available.map((m) => ({
    provider: m.provider,
    id: m.id,
    name: (m as { name?: string }).name ?? m.id,
    baseUrl: (m as { baseUrl?: string }).baseUrl,
    // 透传 Pi SDK `Model.input` (["text"] / ["text", "image"]) ——
    // 供 renderer 在 send 前判断当前 model 是否支持 image。
    // 缺省 = undefined,renderer 侧保守按"不收图"对待。
    input: (m as { input?: ("text" | "image")[] }).input,
  }));
  // Catalog enabled flag is authoritative for TopBar — not only models.json.
  const visible = await filterModelsByCatalogEnabled(mapped);
  return dedupeModelInfosForUi(visible, prefs.provider);
}
