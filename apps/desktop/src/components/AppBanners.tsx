/**
 * `AppBanners` —— Issue #61 主题 F C-201 (2026-08-31).
 *
 * 把 App.tsx 顶层 banner 集合 (Update / prefsRecovery / secretCodec /
 * error / ReadyChecklist / GodotToolsNudge) 抽成独立组件。
 * App 只负责 <AppBanners {...} /> 一行, 大幅瘦身。
 */
import { AlertTriangle } from "lucide-react";
import { useAppUpdate } from "../hooks/useAppUpdate";
import { UpdateBanner } from "./UpdateBanner";
import {
  GodotToolsNudge,
  ReadyChecklist,
  type SettingsTabTarget,
} from "./ReadyChecklist";
import type { ReadyItem } from "../lib/ready-checklist";
import type { PrefsRecoveryNotice, SecretCodecStatus } from "@shared/ipc";
import type { Dispatch, SetStateAction } from "react";

export type AppBannersProps = {
  /** global error banner (通用) */
  error: string | null;
  setError: (e: string | null) => void;
  /** prefs 损坏提示 */
  prefsRecovery: PrefsRecoveryNotice | null;
  setPrefsRecovery: Dispatch<SetStateAction<PrefsRecoveryNotice | null>>;
  /** safeStorage 不可用 */
  secretCodec: SecretCodecStatus | null;
  setSecretCodec: Dispatch<SetStateAction<SecretCodecStatus | null>>;
  /** ready-checklist / nudge 状态 */
  readyBusy: boolean;
  piCliInstalling: boolean;
  readyNotice: string | null;
  setReadyNotice: (n: string | null) => void;
  showReadyChecklist: boolean;
  showGodotToolsNudge: boolean;
  setReadyChecklistHidden: (b: boolean) => void;
  /** ready-checklist items + actions */
  readyItems: ReadyItem[];
  actions: {
    muteReadyChecklist: () => Promise<void>;
    installPi: () => Promise<void>;
    openPiLogin: () => Promise<void>;
    openGitDownload: () => Promise<void>;
    openNodeDownload: () => Promise<void>;
    installRpcAddon: () => Promise<void>;
    startRpcBridge: () => Promise<void>;
    launchGodotEditor: () => Promise<void>;
    enableGodotEditorTools: () => Promise<void>;
    dismissGodotToolsNudge: () => Promise<void>;
  };
  applyBash: () => Promise<void>;
  openSettingsAt: (tab: SettingsTabTarget) => void;
  /** composite busy flag (busy || status streaming/retrying) */
  busy: boolean;
};

/**
 * 抽出 App 顶层的所有 banner 与 ReadyChecklist。组件内自己 useAppUpdate
 * 拿 update 状态 (避免 App 暴露 updateStatus/busy 给 banner 太多 props)。
 */
export function AppBanners(props: AppBannersProps) {
  const {
    error,
    setError,
    prefsRecovery,
    setPrefsRecovery,
    secretCodec,
    setSecretCodec,
    readyBusy,
    piCliInstalling,
    readyNotice,
    setReadyNotice,
    showReadyChecklist,
    showGodotToolsNudge,
    setReadyChecklistHidden,
    readyItems,
    actions,
    applyBash,
    openSettingsAt,
    busy,
  } = props;

  const appUpdate = useAppUpdate({ onError: (msg) => setError(msg) });
  const {
    status: updateStatus,
    busy: updateActionBusy,
    showBanner: showUpdateBanner,
    dismiss: dismissUpdateBanner,
    downloadOrInstall: applyUpdateAction,
  } = appUpdate;

  return (
    <>
      {showUpdateBanner && updateStatus && (
        <UpdateBanner
          status={updateStatus}
          busy={updateActionBusy}
          onUpdate={() => {
            void applyUpdateAction();
          }}
          onDismiss={dismissUpdateBanner}
        />
      )}
      {prefsRecovery && (
        <div className="banner warn">
          <AlertTriangle size={14} />
          <span>
            偏好文件损坏，已使用默认设置
            {prefsRecovery.backedUp && prefsRecovery.backupPath
              ? `（备份：${prefsRecovery.backupPath}）`
              : `（${prefsRecovery.error}）`}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setPrefsRecovery(null)}
          >
            关闭
          </button>
        </div>
      )}
      {secretCodec && !secretCodec.available && (
        <div className="banner warn">
          <AlertTriangle size={14} />
          <span>
            供应商密钥将以明文存储——系统密钥链不可用
            {secretCodec.reason === "keychain-unavailable"
              ? "(safeStorage 不可用)"
              : secretCodec.reason === "encrypt-failed"
                ? "(safeStorage 加密失败)"
                : "(未在 Electron 环境中)"}
            。请到「设置 → 供应商」检查密钥是否需要重新保存。
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setSecretCodec(null)}
          >
            关闭
          </button>
        </div>
      )}
      {showReadyChecklist && (
        <ReadyChecklist
          items={readyItems}
          busy={readyBusy || busy}
          piCliInstalling={piCliInstalling}
          notice={readyNotice}
          onDismissNotice={() => setReadyNotice(null)}
          onDismiss={() => {
            setReadyChecklistHidden(true);
          }}
          onDontRemind={() => {
            void actions.muteReadyChecklist();
          }}
          onOpenSettings={openSettingsAt}
          onInstallPiCli={() => {
            void actions.installPi();
          }}
          onOpenPiLogin={() => {
            void actions.openPiLogin();
          }}
          onApplyBash={() => {
            void applyBash();
          }}
          onOpenGitDownload={() => {
            void actions.openGitDownload();
          }}
          onOpenNodeDownload={() => {
            void actions.openNodeDownload();
          }}
          onInstallRpcAddon={() => {
            void actions.installRpcAddon();
          }}
          onStartRpcBridge={() => {
            void actions.startRpcBridge();
          }}
          onLaunchGodotEditor={() => {
            void actions.launchGodotEditor();
          }}
          onEnableGodotTools={() => {
            void actions.enableGodotEditorTools();
          }}
        />
      )}
      {showGodotToolsNudge && (
        <GodotToolsNudge
          visible
          busy={readyBusy}
          onEnable={() => {
            void actions.enableGodotEditorTools();
          }}
          onDismiss={() => {
            void actions.dismissGodotToolsNudge();
          }}
          onOpenSettings={() => openSettingsAt("tools")}
        />
      )}
      {error && (
        <div className="banner error">
          <AlertTriangle size={14} />
          <span>{error}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setError(null)}
          >
            关闭
          </button>
        </div>
      )}
    </>
  );
}
