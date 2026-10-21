/** Show each theme on a miniature workbench so colors can be compared before applying. */
import { useState } from "react";
import { Check } from "lucide-react";
import { SettingsNotice } from "../SettingsNotice";
import {
  THEME_IDS,
  THEME_LABELS,
  type ClientPrefs,
  type ThemeId,
} from "@shared/ipc";

type Props = {
  prefs: ClientPrefs;
  onPrefsChanged?: (prefs: ClientPrefs) => void;
};

/** Persist a theme through the existing preference boundary and keep failed saves visible. */
export function ThemePicker({ prefs, onPrefsChanged }: Props) {
  const [pending, setPending] = useState<ThemeId | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Wait for persistence before marking a card as selected. */
  async function selectTheme(themeId: ThemeId) {
    if (pending || themeId === prefs.themeId) return;
    setPending(themeId);
    setError(null);
    try {
      const next = await window.xAgent.prefs.set({ themeId });
      onPrefsChanged?.(next);
    } catch {
      setError("主题保存失败，请重试。");
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <div className="theme-grid" role="group" aria-label="主题" aria-busy={pending !== null}>
        {THEME_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className="theme-card"
            aria-label={THEME_LABELS[id]}
            aria-pressed={prefs.themeId === id}
            disabled={pending !== null}
            onClick={() => { void selectTheme(id); }}
          >
            <span className="theme-preview" data-theme-preview={`${id}-${prefs.colorMode}`} aria-hidden="true">
              <span className="theme-preview-top"><i /><i /><i /></span>
              <span className="theme-preview-body">
                <span className="theme-preview-rail"><i /><i /><i /><i /></span>
                <span className="theme-preview-chat">
                  <span className="theme-preview-user" />
                  <span className="theme-preview-line" />
                  <span className="theme-preview-line short" />
                  <span className="theme-preview-tool"><i /><i /></span>
                  <span className="theme-preview-composer"><i /></span>
                </span>
                <span className="theme-preview-panel"><i /><i /><i /></span>
              </span>
            </span>
            <span className="theme-card-label">
              <span>{THEME_LABELS[id]}</span>
              {prefs.themeId === id && <Check size={14} aria-hidden="true" />}
            </span>
          </button>
        ))}
      </div>
      {error && (
        <SettingsNotice text={error} tone="error" onDismiss={() => setError(null)} />
      )}
    </>
  );
}
