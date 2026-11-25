import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import { useModalFocus } from "../hooks/useModalFocus";
import {
  Boxes,
  ChartColumn,
  Gamepad2,
  Puzzle,
  Settings2,
  Wrench,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  type BashCheckResult,
  type ClientPrefs,
  type GitCheckResult,
  type PiCliStatus,
} from "@shared/ipc";
import { PluginsPage } from "./PluginsPage";
import { UsageSettingsPage } from "./UsageSettingsPage";
import { GeneralSettingsPage } from "./settings/GeneralSettingsPage";
import { ToolsSettingsPage } from "./settings/ToolsSettingsPage";
import { GodotSettingsPage } from "./settings/GodotSettingsPage";
import { ProvidersSettingsPage, type ProviderEditorHandle } from "./settings/ProvidersSettingsPage";

export type SettingsTab =
  | "general"
  | "providers"
  | "tools"
  | "plugins"
  | "godot"
  | "usage";

interface Props {
  open: boolean;
  backdropRef: Ref<HTMLDivElement>;
  prefs: ClientPrefs;
  cwd: string | null;
  onClose: () => void;
  onToggleTool: (tool: string) => void;
  /** When true, tool whitelist changes warn about prefix-cache invalidation. */
  hasActiveSession?: boolean;
  onProvidersChanged?: () => void;
  onPrefsChanged?: (prefs: ClientPrefs) => void;
  onBashChanged?: (bash: BashCheckResult) => void;
  onGitChanged?: (git: GitCheckResult) => void;
  onPiCliChanged?: (piCli: PiCliStatus) => void;
  /** When set, switch to this tab when the panel opens */
  initialTab?: SettingsTab;
}

export function SettingsPanel({
  open,
  backdropRef,
  prefs,
  cwd,
  onClose,
  onToggleTool,
  hasActiveSession = false,
  onProvidersChanged,
  onPrefsChanged,
  onBashChanged,
  onGitChanged,
  onPiCliChanged,
  initialTab,
}: Props) {
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? "providers");
  const providerEditor = useRef<ProviderEditorHandle>(null);

  /** Keep provider edits when switching tabs; verify a discard only when closing settings. */
  const requestClose = useCallback(async () => {
    if (!providerEditor.current || await providerEditor.current.confirmDiscard()) onClose();
  }, [onClose]);

  useEffect(() => {
    if (open && initialTab) setTab(initialTab);
  }, [open, initialTab]);

  const panelRef = useModalFocus<HTMLDivElement>(open, requestClose);

  const tabs: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
    { id: "general", label: "通用", icon: Settings2 },
    { id: "providers", label: "供应商", icon: Boxes },
    { id: "usage", label: "用量", icon: ChartColumn },
    { id: "tools", label: "工具", icon: Wrench },
    { id: "plugins", label: "插件", icon: Puzzle },
    { id: "godot", label: "Godot", icon: Gamepad2 },
  ];

  return (
    <div ref={backdropRef} className="modal-backdrop" inert={!open} role="presentation" onClick={() => void requestClose()}>
      <div
        ref={panelRef}
        className="modal-panel settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>设置</h2>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="关闭设置" title="关闭设置" onClick={() => void requestClose()}>
            <X size={14} />
          </button>
        </div>

        <div className="settings-layout">
          <nav className="settings-nav">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-current={tab === t.id ? "page" : undefined}
                  className={
                    tab === t.id
                      ? "settings-nav-item active"
                      : "settings-nav-item"
                  }
                  onClick={() => setTab(t.id)}
                >
                  <Icon size={14} />
                  {t.label}
                </button>
              );
            })}
          </nav>

          <div
            className={
              tab === "plugins"
                ? "settings-content settings-content--plugins"
                : "settings-content"
            }
          >
            {tab === "general" && (
              <GeneralSettingsPage
                open={tab === "general"}
                prefs={prefs}
                onPrefsChanged={onPrefsChanged}
                onBashChanged={onBashChanged}
                onGitChanged={onGitChanged}
                onPiCliChanged={onPiCliChanged}
                onOpenProviders={() => setTab("providers")}
              />
            )}

            {tab === "usage" && <UsageSettingsPage active={tab === "usage"} />}

            {tab === "tools" && (
              <ToolsSettingsPage
                onOpenProviders={() => setTab("providers")}
                prefs={prefs}
                hasActiveSession={hasActiveSession}
                onToggleTool={onToggleTool}
                onPrefsChanged={onPrefsChanged}
                onOpenGodotSettings={() => setTab("godot")}
              />
            )}

            {tab === "godot" && (
              <GodotSettingsPage
                key={cwd}
                onOpenTools={() => setTab("tools")}
                open={tab === "godot"}
                prefs={prefs}
                cwd={cwd}
                onPrefsChanged={onPrefsChanged}
              />
            )}

            {tab === "plugins" && (
              <PluginsPage
                cwd={cwd}
                prefs={prefs}
                hasActiveSession={hasActiveSession}
                onPrefsChanged={onPrefsChanged}
              />
            )}

            <ProvidersSettingsPage
              ref={providerEditor}
              open={tab === "providers"}
              onProvidersChanged={onProvidersChanged}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
