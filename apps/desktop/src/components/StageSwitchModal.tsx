import { AlertTriangle, Check, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { GraduationStatus, StageId, StageInfo } from "@shared/stage";
import { STAGE_LABELS } from "@shared/stage";
import { STAGE_DEFINITIONS } from "@shared/stage-defs";

interface Props {
  target: StageId;
  stageInfo: StageInfo;
  onCancel: () => void;
  onConfirm: () => Promise<unknown>;
  onToggleCheck: (checkId: string, value: boolean) => void;
}

export function StageSwitchModal({
  target,
  stageInfo,
  onCancel,
  onConfirm,
  onToggleCheck,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [localChecks, setLocalChecks] = useState<Record<string, boolean>>({});
  const [graduation, setGraduation] = useState<GraduationStatus | null>(null);

  // Fetch the current stage's graduation status when the modal opens.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await window.xAgent.stage.getGraduation(stageInfo.current);
      if (!cancelled) {
        setGraduation(result);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stageInfo.current]);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const checks = graduation?.checks ?? [];
  const passed = checks.filter((c) => c.passed).length;
  const total = checks.length;
  const allPassed = total === 0 || passed === total;
  const incomplete = total - passed;

  // Map check id → original GraduationCheck (for the `kind` field).
  const checkKindById = new Map(
    (STAGE_DEFINITIONS[stageInfo.current]?.graduation ?? []).map((c) => [
      c.id,
      c.kind,
    ]),
  );

  const effectiveCheck = (id: string, originalPassed: boolean) => {
    if (localChecks[id] !== undefined) return localChecks[id]!;
    return originalPassed;
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      // Persist any local toggles before switching.
      for (const [id, value] of Object.entries(localChecks)) {
        await onToggleCheck(id, value);
      }
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`切换到 ${STAGE_LABELS[target]}`}
      onClick={onCancel}
    >
      <div
        className="modal-panel stage-switch-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>切换到 {STAGE_LABELS[target]}？</h2>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            onClick={onCancel}
            aria-label="关闭"
          >
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">
          <section className="stage-switch-section">
            <h3>当前 {STAGE_LABELS[stageInfo.current]} 阶段的毕业条件</h3>
            {total === 0 ? (
              <p className="stage-switch-empty">该阶段无需毕业条件。</p>
            ) : (
              <>
                <ul className="stage-switch-checks">
                  {checks.map((c) => {
                    const passed = effectiveCheck(c.id, c.passed);
                    const kind = checkKindById.get(c.id);
                    return (
                      <li
                        key={c.id}
                        className={passed ? "is-passed" : "is-pending"}
                      >
                        {kind === "manual" ? (
                          <button
                            type="button"
                            className="stage-switch-check-toggle"
                            disabled={submitting}
                            onClick={() =>
                              setLocalChecks((prev) => ({
                                ...prev,
                                [c.id]: !passed,
                              }))
                            }
                            aria-pressed={passed}
                          >
                            {passed ? (
                              <Check size={12} aria-hidden />
                            ) : (
                              <Square size={12} aria-hidden />
                            )}
                          </button>
                        ) : passed ? (
                          <Check size={12} aria-hidden />
                        ) : (
                          <Square size={12} aria-hidden />
                        )}
                        <span className="stage-switch-check-label">{c.label}</span>
                        {c.detail && (
                          <span className="stage-switch-check-detail">
                            {c.detail}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="stage-switch-progress">
                  已达成 {passed} / {total}
                </p>
              </>
            )}
          </section>
          {!allPassed && (
            <p className="stage-switch-warning">
              <AlertTriangle size={14} aria-hidden /> 还有 {incomplete}{" "}
              项未达标，仍可继续切换。
            </p>
          )}
        </div>
        <footer className="modal-foot">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onCancel}
            disabled={submitting}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleConfirm}
            disabled={submitting}
          >
            {allPassed ? "切换" : "忽略警告继续切换"}
          </button>
        </footer>
      </div>
    </div>
  );
}
