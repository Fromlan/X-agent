import { AlertTriangle, FileMinus2, FilePenLine, MessageSquareDashed } from "lucide-react";
import type { RetractPreview } from "@shared/ipc";

export type RetractConfirmMode = "retract" | "edit" | "regenerate";

interface Props {
  mode: RetractConfirmMode;
  preview: RetractPreview;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const TITLES: Record<RetractConfirmMode, string> = {
  retract: "撤回此轮对话",
  edit: "编辑并重发",
  regenerate: "重新生成",
};

const SUMMARIES: Record<RetractConfirmMode, string> = {
  retract: "将丢弃该条消息之后的回复，并把原文放回输入框。",
  edit: "将用新内容替换该条消息，并丢弃其后的回复。",
  regenerate: "将保留该条用户消息，并重新生成其后的回复。",
};

const CONFIRM_LABELS: Record<RetractConfirmMode, string> = {
  retract: "撤回",
  edit: "重发",
  regenerate: "重新生成",
};

export function RetractConfirmModal(props: Props) {
  const { preview, mode } = props;
  const restoreCount = preview.restorablePaths.length;
  const unrestorableCount = preview.unrestorablePaths.length;
  const hasFiles = restoreCount > 0 || unrestorableCount > 0;
  const shadowMode = preview.restoreMode === "shadow";
  const hasRisk =
    (!shadowMode && preview.hasBash) ||
    preview.hasGodot ||
    unrestorableCount > 0 ||
    Boolean(preview.warnings.length);

  return (
    <div className="modal-backdrop" role="presentation" onClick={props.onCancel}>
      <div
        className="modal-panel retract-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="retract-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="retract-confirm-title">{TITLES[mode]}</h2>
        </div>

        <div className="retract-confirm-body">
          <p className="retract-confirm-lead">{SUMMARIES[mode]}</p>

          <ul className="retract-confirm-facts">
            <li>
              <MessageSquareDashed size={14} aria-hidden />
              <span>截断后续对话上下文</span>
            </li>
            {restoreCount > 0 && (
              <li>
                <FilePenLine size={14} aria-hidden />
                <span>
                  {shadowMode
                    ? `还原工作区 ${restoreCount} 个文件（Shadow 检查点）`
                    : `还原 ${restoreCount} 个 write/edit 文件`}
                </span>
              </li>
            )}
            {restoreCount === 0 && unrestorableCount === 0 && (
              <li>
                <FilePenLine size={14} aria-hidden />
                <span>
                  {shadowMode
                    ? "工作区与检查点一致，无需改文件"
                    : "无已知文件改动可还原"}
                </span>
              </li>
            )}
            {unrestorableCount > 0 && (
              <li className="is-warn">
                <FileMinus2 size={14} aria-hidden />
                <span>{unrestorableCount} 个文件缺少基线，无法还原</span>
              </li>
            )}
          </ul>

          {hasFiles && (
            <div className="retract-path-block">
              <div className="retract-path-label">涉及文件</div>
              <ul className="retract-path-list">
                {preview.restorablePaths.map((p) => (
                  <li key={`ok-${p}`} title={p}>
                    <span className="retract-path-tag">还原</span>
                    <code>{p}</code>
                  </li>
                ))}
                {preview.unrestorablePaths.map((p) => (
                  <li key={`skip-${p}`} className="is-warn" title={p}>
                    <span className="retract-path-tag is-warn">跳过</span>
                    <code>{p}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasRisk && (
            <div className="retract-warn" role="note">
              <AlertTriangle size={14} aria-hidden />
              <ul>
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
                {preview.hasGodot &&
                  !preview.warnings.some((w) => w.includes("Godot")) && (
                    <li>含 Godot 工具：编辑器状态无法还原</li>
                  )}
                {!shadowMode &&
                  preview.hasBash &&
                  !preview.warnings.some((w) => w.includes("bash")) && (
                    <li>含 bash：命令副作用无法保证还原</li>
                  )}
                {unrestorableCount > 0 &&
                  !preview.hasBash &&
                  !preview.hasGodot &&
                  preview.warnings.length === 0 && (
                    <li>部分文件无法自动还原</li>
                  )}
              </ul>
            </div>
          )}
        </div>

        <div className="modal-actions retract-confirm-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={props.onCancel}
            disabled={props.busy}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn-cta"
            onClick={props.onConfirm}
            disabled={props.busy}
          >
            {props.busy ? "处理中…" : CONFIRM_LABELS[mode]}
          </button>
        </div>
      </div>
    </div>
  );
}
