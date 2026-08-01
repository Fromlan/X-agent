import { FolderInput, Hammer, Loader2, Save, X } from "lucide-react";
import { usePlanSession, planFileLabel } from "../../hooks/usePlanSession";

interface Props {
  planPath: string | null;
  busy: boolean;
  onBuildPlan: () => void;
  onPlanPathChange?: (path: string | null) => void;
}

export function PlanTab({
  planPath,
  busy,
  onBuildPlan,
  onPlanPathChange,
}: Props) {
  const {
    markdown,
    loadedPath,
    location,
    dirty,
    loading,
    saving,
    error,
    hint,
    save,
    saveToWorkspace,
    clear,
    execute,
    onMarkdownChange,
    disabled,
  } = usePlanSession({ planPath, busy, onBuildPlan, onPlanPathChange });

  if (!planPath) {
    return (
      <div className="rp-plan-empty">
        <p>尚无计划文件。</p>
        <p className="rp-muted">
          只需问答请用「调研」；要可执行方案请切 Plan，让 Agent 研究后调用
          write_plan。生成后可在此编辑；切换 Agent / 调研 / 目标不会丢失当前计划。
        </p>
      </div>
    );
  }

  return (
    <div className="rp-plan">
      <div className="rp-plan-meta">
        <span className="rp-plan-name" title={loadedPath ?? planPath}>
          {planFileLabel(loadedPath ?? planPath)}
        </span>
        <span className="rp-plan-loc">
          {location === "workspace" ? "项目" : "本机"}
          {dirty ? " · 未保存" : ""}
        </span>
      </div>
      {loading ? (
        <div className="rp-plan-loading">
          <Loader2 size={14} className="icon-spin" />
          加载中…
        </div>
      ) : (
        <textarea
          className="rp-plan-editor"
          value={markdown}
          onChange={(e) => {
            onMarkdownChange(e.target.value);
          }}
          spellCheck={false}
          disabled={disabled || loading}
          aria-label="计划 Markdown"
        />
      )}
      {error && <div className="rp-plan-error">{error}</div>}
      {hint && !error && <div className="rp-plan-hint">{hint}</div>}
      <div className="rp-plan-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={disabled || loading || !dirty}
          onClick={() => {
            void save();
          }}
        >
          <Save size={14} aria-hidden />
          保存
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={disabled || loading || location === "workspace"}
          title="复制到项目 .pi/plans/"
          onClick={() => {
            void saveToWorkspace();
          }}
        >
          <FolderInput size={14} aria-hidden />
          保存到项目
        </button>
        <button
          type="button"
          className="btn btn-cta btn-sm"
          disabled={disabled || loading}
          onClick={() => {
            void execute();
          }}
        >
          <Hammer size={14} aria-hidden />
          执行计划
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={disabled || loading}
          title="清除会话中的计划引用（不删除磁盘文件）"
          onClick={() => {
            void clear();
          }}
        >
          <X size={14} aria-hidden />
          清除引用
        </button>
      </div>
    </div>
  );
}
