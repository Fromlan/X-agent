import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";

export type ConfirmTone = "default" | "warn" | "danger";

type Props = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "确定",
  cancelLabel = "取消",
  tone = "default",
  busy = false,
  onCancel,
  onConfirm,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  // 视觉权重：warn/danger 场景下，confirm（继续/确定）是用户主动选择的风险动作，
  // 应当更显眼（CTA），cancel 是安全兜底（ghost）。autoFocus 仍留在 cancel，
  // 这样误按 Enter 会走安全分支；点击则需用户明确选中 confirm。
  const safeDefault = tone === "warn" || tone === "danger";
  const cancelClass = "btn btn-ghost";
  const confirmClass = safeDefault
    ? tone === "danger"
      ? "btn btn-cta confirm-danger-action"
      : "btn btn-cta"
    : "btn btn-cta";

  return (
    <div
      className="modal-backdrop confirm-backdrop"
      role="presentation"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className={`modal-panel confirm-modal tone-${tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="app-confirm-title">{title}</h2>
        </div>
        <div className="confirm-modal-body">
          {(tone === "warn" || tone === "danger") && (
            <div className={`confirm-modal-icon is-${tone}`} aria-hidden>
              <AlertTriangle size={16} />
            </div>
          )}
          <p className="confirm-modal-message">{message}</p>
        </div>
        <div className="modal-actions confirm-modal-actions">
          <button
            type="button"
            className={cancelClass}
            disabled={busy}
            autoFocus={safeDefault}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={confirmClass}
            disabled={busy}
            autoFocus={!safeDefault}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
