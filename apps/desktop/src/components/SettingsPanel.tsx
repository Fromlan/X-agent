import { useEffect, useRef, useState } from "react";
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
import {
  GodotSettingsPage,
  type GodotSettingsSection,
} from "./settings/GodotSettingsPage";
import { ProvidersSettingsPage } from "./settings/ProvidersSettingsPage";

export type SettingsTab =
  | "general"
  | "providers"
  | "tools"
  | "plugins"
  | "godot"
  | "usage";

interface Props {
  open: boolean;
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
  /** When set with godot tab, select editor/docs sub-section. */
  initialGodotSection?: GodotSettingsSection;
}

export function SettingsPanel({
  open,
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
  initialGodotSection,
}: Props) {
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? "providers");
  const [godotSection, setGodotSection] =
    useState<GodotSettingsSection>(initialGodotSection ?? "editor");
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open && initialTab) setTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (open && initialGodotSection) setGodotSection(initialGodotSection);
  }, [open, initialGodotSection]);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocusedRef.current?.focus();
      previouslyFocusedRef.current = null;
    };
  }, [open, onClose]);

  if (!open) return null;

  const tabs: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
    { id: "general", label: "通用", icon: Settings2 },
    { id: "providers", label: "供应商", icon: Boxes },
    { id: "usage", label: "用量", icon: ChartColumn },
    { id: "tools", label: "工具", icon: Wrench },
    { id: "plugins", label: "插件", icon: Puzzle },
    { id: "godot", label: "Godot", icon: Gamepad2 },
  ];

  const openGodotSection = (section: GodotSettingsSection) => {
    setTab("godot");
    setGodotSection(section);
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
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
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose}>
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
                open={open && tab === "general"}
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
                prefs={prefs}
                hasActiveSession={hasActiveSession}
                onToggleTool={onToggleTool}
                onPrefsChanged={onPrefsChanged}
                onOpenGodotSection={openGodotSection}
              />
            )}

            {tab === "godot" && (
              <GodotSettingsPage
                open={open && tab === "godot"}
                prefs={prefs}
                cwd={cwd}
                section={godotSection}
                onSectionChange={setGodotSection}
                onPrefsChanged={onPrefsChanged}
              />
            )}

            {tab === "plugins" && <PluginsPage cwd={cwd} />}

            <ProvidersSettingsPage
              open={open && tab === "providers"}
              onProvidersChanged={onProvidersChanged}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
