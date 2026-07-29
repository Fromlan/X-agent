import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export type NoticeTone = "neutral" | "warn" | "error";

type SettingsNoticeProps = {
  text: string;
  tone?: NoticeTone;
  onDismiss: () => void;
  /** Large payload (e.g. RPC JSON). */
  pre?: boolean;
};

/** Dismissible in-settings notice; does not span other settings tabs by itself. */
export function SettingsNotice({
  text,
  tone = "neutral",
  onDismiss,
  pre = false,
}: SettingsNoticeProps) {
  return (
    <div
      className={[
        "settings-notice",
        tone === "warn" ? "is-warn" : "",
        tone === "error" ? "is-error" : "",
        pre ? "is-pre" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="status"
    >
      {pre ? (
        <pre className="settings-notice-body">{text}</pre>
      ) : (
        <span className="settings-notice-body">{text}</span>
      )}
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-icon settings-notice-dismiss"
        title="关闭提示"
        aria-label="关闭提示"
        onClick={onDismiss}
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** Auto-clear a success / ephemeral string notice. */
export function useAutoClearNotice(
  notice: string | null,
  clear: () => void,
  ms = 4500,
  enabled = true,
): void {
  const clearRef = useRef(clear);
  clearRef.current = clear;
  useEffect(() => {
    if (!enabled || !notice) return;
    const timer = window.setTimeout(() => clearRef.current(), ms);
    return () => window.clearTimeout(timer);
  }, [notice, ms, enabled]);
}
