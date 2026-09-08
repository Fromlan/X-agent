/**
 * `useSessionBootstrap` —— Issue #61 主题 F (2026-08-31).
 *
 * 把 useWorkspaceSession 里的 bootstrap useEffect 抽出独立 hook:
 *
 * 启动期初始化 (mount 时跑一次):
 * 1) 偏好 / recovery / codec
 * 2) bash / git / auth / piCli 探测
 * 3) models / sessions 列表
 * 4) 自动打开 last project (新会话, 不恢复)
 *
 * 抽出后:
 * - useWorkspaceSession 缩到只管 workspace 操作 (open / new / resume / ...)
 * - App.tsx composition 看起来更扁, 不再被 80 行 bootstrap 顶
 * - 这块逻辑以后想抽到顶层命令式 init 流程也方便
 */
import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type {
  AuthStatus,
  BashCheckResult,
  ClientPrefs,
  GitCheckResult,
  PiCliStatus,
  PrefsRecoveryNotice,
  SecretCodecStatus,
  ThinkingLevel,
} from "@shared/ipc";
import type { SessionType } from "@shared/session-type";
import { DEFAULT_SESSION_TYPE } from "@shared/session-type";
import { createEmptyState, type ChatItem } from "../stores/chat-store";
import { withBusyLifecycle } from "./withBusyLifecycle";
import { syncFromHost } from "./session-bootstrap-sync";

export type UseSessionBootstrapOpts = {
  setPrefs: Dispatch<SetStateAction<ClientPrefs | null>>;
  setPrefsRecovery: Dispatch<SetStateAction<PrefsRecoveryNotice | null>>;
  setSecretCodec: Dispatch<SetStateAction<SecretCodecStatus | null>>;
  setBash: Dispatch<SetStateAction<BashCheckResult | null>>;
  setGit: Dispatch<SetStateAction<GitCheckResult | null>>;
  setAuth: Dispatch<SetStateAction<AuthStatus | null>>;
  setPiCli: Dispatch<SetStateAction<PiCliStatus | null>>;
  setItems: Dispatch<SetStateAction<ChatItem[]>>;
  setQueuedSteering: Dispatch<SetStateAction<string[]>>;
  setCwd: Dispatch<SetStateAction<string | null>>;
  setSessionId: Dispatch<SetStateAction<string | null>>;
  setSessionType: Dispatch<SetStateAction<SessionType>>;
  setFollowNonce: Dispatch<SetStateAction<number>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setAvailableThinkingLevels: Dispatch<SetStateAction<ThinkingLevel[] | null>>;
  setEditingEntryId: Dispatch<SetStateAction<string | null>>;
  setEditDraft: Dispatch<SetStateAction<string>>;
  setConfirmState: Dispatch<SetStateAction<unknown>>;
  sessionIdRef: MutableRefObject<string | null>;
  usageFetchGen: MutableRefObject<number>;
  refreshModels: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  refreshProjectReadiness: (cwd: string | null) => Promise<void>;
  fetchSessionUsage: () => void;
};

/**
 * 启动期初始化 + 打开 last project. mount 时跑一次, 内部 cancelled
 * flag 防 abort。boot 末尾调 `window.xAgent.notifyAppReady()` 通知
 * 主进程 splash 可以关。
 */
export function useSessionBootstrap(opts: UseSessionBootstrapOpts): void {
  const {
    setPrefs,
    setPrefsRecovery,
    setSecretCodec,
    setBash,
    setGit,
    setAuth,
    setPiCli,
    setItems,
    setQueuedSteering,
    setCwd,
    setSessionId,
    setSessionType,
    setFollowNonce,
    setError,
    setBusy,
    setAvailableThinkingLevels,
    setEditingEntryId,
    setEditDraft,
    setConfirmState,
    sessionIdRef,
    usageFetchGen,
    refreshModels,
    refreshSessions,
    refreshProjectReadiness,
    fetchSessionUsage,
  } = opts;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // ---- Phase 1: 偏好 / codec / 工具链探测 ----
        const [p, recovery, codec] = await Promise.all([
          window.xAgent.prefs.get(),
          window.xAgent.prefs.getRecoveryNotice(),
          window.xAgent.prefs.getSecretCodecStatus(),
        ]);
        if (cancelled) return;
        setPrefs(p);
        if (recovery) setPrefsRecovery(recovery);
        if (codec) setSecretCodec(codec);
        document.body.dataset.theme = `${p.themeId}-${p.colorMode}`;
        setBash(await window.xAgent.prefs.checkBash());
        setGit(await window.xAgent.prefs.checkGit());
        setAuth(await window.xAgent.prefs.checkAuth());
        setPiCli(await window.xAgent.prefs.checkPiCli());
        if (cancelled) return;

        // ---- Phase 2: models + sessions 列表 ----
        await refreshModels();
        if (cancelled) return;
        await refreshSessions();
        if (cancelled) return;

        // ---- Phase 3: 自动打开 last project (新会话, 不恢复) ----
        if (p.lastProjectPath) {
          await withBusyLifecycle(setBusy, setError, async () => {
            setItems(createEmptyState());
            setQueuedSteering([]);
            const result = await window.xAgent.workspace.open(
              p.lastProjectPath!,
              "new",
            );
            if (cancelled) return;
            if (result.ok) {
              setCwd(result.cwd);
              setSessionId(result.sessionId);
              setSessionType(result.sessionType ?? DEFAULT_SESSION_TYPE);
              setFollowNonce((n) => n + 1);
              if (result.warning) setError(result.warning);
              await refreshProjectReadiness(result.cwd);
            } else if (result.error && result.error !== "已取消") {
              setError(result.error);
              // 同步 host 状态 (清掉 lastProject 残留)
              await syncFromHost({
                setStatus: () => undefined,
                setCwd,
                setSessionId,
                sessionIdRef,
                setItems,
                setQueuedSteering,
                setEditingEntryId,
                setEditDraft,
                setConfirmState,
                setError,
                setPrefs,
                setAvailableThinkingLevels,
                usageFetchGen,
                fetchSessionUsage,
              });
            }
          });
        }
        await refreshSessions();
      } finally {
        if (!cancelled) {
          void window.xAgent.notifyAppReady();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // bootstrap 只跑一次 (mount), 不依赖任何外部 state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
