/**
 * `AppSettingsPanel` —— Issue #61 主题 F C-201 (2026-08-31).
 *
 * 把 App.tsx 内的 SettingsPanel 包装抽成独立组件, props 收敛到
 * 必要的 state + actions。
 */
import {
  SettingsPanel,
  type SettingsTab,
} from "./SettingsPanel";
import type {
  AuthStatus,
  BashCheckResult,
  ClientPrefs,
  GitCheckResult,
  PiCliStatus,
} from "@shared/ipc";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";

export type AppSettingsPanelProps = {
  open: boolean;
  prefs: ClientPrefs;
  cwd: string | null;
  logo: import("../hooks/useLogo").UseLogoResult;
  initialTab: SettingsTab | undefined;
  hasActiveSession: boolean;
  onClose: () => void;
  onToggleTool: (tool: string) => Promise<void>;
  onPrefsChanged: (p: ClientPrefs) => void;
  onBashChanged: Dispatch<SetStateAction<BashCheckResult | null>>;
  onGitChanged: Dispatch<SetStateAction<GitCheckResult | null>>;
  onPiCliChanged: Dispatch<SetStateAction<PiCliStatus | null>>;
  onProvidersChanged: () => Promise<void>;
  setAuth: Dispatch<SetStateAction<AuthStatus | null>>;
};

export function AppSettingsPanel(props: AppSettingsPanelProps) {
  const {
    open,
    prefs,
    cwd,
    logo,
    initialTab,
    hasActiveSession,
    onClose,
    onToggleTool,
    onPrefsChanged,
    onBashChanged,
    onGitChanged,
    onPiCliChanged,
    onProvidersChanged,
    setAuth,
  } = props;

  const handlePrefsChanged = useCallback(
    (p: ClientPrefs) => {
      onPrefsChanged(p);
      document.body.dataset.theme = `${p.themeId}-${p.colorMode}`;
    },
    [onPrefsChanged],
  );

  const handleProvidersChanged = useCallback(async () => {
    await onProvidersChanged();
    setAuth(await window.xAgent.prefs.checkAuth());
  }, [onProvidersChanged, setAuth]);

  if (!open) return null;
  return (
    <SettingsPanel
      open={open}
      prefs={prefs}
      cwd={cwd}
      logo={logo}
      initialTab={initialTab}
      onClose={onClose}
      onToggleTool={onToggleTool}
      hasActiveSession={hasActiveSession}
      onPrefsChanged={handlePrefsChanged}
      onBashChanged={onBashChanged}
      onGitChanged={onGitChanged}
      onPiCliChanged={onPiCliChanged}
      onProvidersChanged={handleProvidersChanged}
    />
  );
}
