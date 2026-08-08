import { CheckSquare, FolderInput, Hammer, Loader2, Save, Square, X } from "lucide-react";
import { useMemo, useState } from "react";
import { usePlanSession, planFileLabel } from "../../hooks/usePlanSession";
import { parsePlanTodos, togglePlanTodo } from "../../lib/plan-todos";
import { MarkdownBody } from "../MarkdownBody";

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

  const todos = useMemo(() => parsePlanTodos(markdown), [markdown]);
  const [viewMode, setViewMode] = useState<"render" | "source">("render");

  if (!planPath) {
    return (
      <div className="rp-plan-empty">
        <p>尚无计划文件。</p>
        <p className="rp-muted">切 Plan 后由 Agent 调用 write_plan 生成。</p>
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
        <button
          type="button"
          className="btn btn-ghost btn-sm rp-plan-view-toggle"
          onClick={() =>
            setViewMode((m) => (m === "render" ? "source" : "render"))
          }
          title={viewMode === "render" ? "切换为源码编辑" : "切换为渲染预览"}
          aria-pressed={viewMode === "source"}
        >
          {viewMode === "render" ? "源码" : "渲染"}
        </button>
      </div>
      {todos.length > 0 && (
        <ul className="rp-plan-todos" aria-label="计划步骤">
          {todos.map((todo) => (
            <li key={todo.lineIndex} className="rp-plan-todo">
              <button
                type="button"
                className="rp-plan-todo-toggle"
                disabled={disabled || loading}
                aria-pressed={todo.checked}
                title={todo.checked ? "标记未完成" : "标记完成"}
                onClick={() => {
                  onMarkdownChange(
                    togglePlanTodo(markdown, todo.lineIndex),
                  );
                }}
              >
                {todo.checked ? (
                  <CheckSquare size={14} aria-hidden />
                ) : (
                  <Square size={14} aria-hidden />
                )}
                <span
                  className={
                    todo.checked ? "rp-plan-todo-text is-done" : "rp-plan-todo-text"
                  }
                >
                  {todo.text}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {loading ? (
        <div className="rp-plan-loading">
          <Loader2 size={14} className="icon-spin" />
          加载中…
        </div>
      ) : viewMode === "render" ? (
        <div className="rp-plan-preview" aria-label="计划渲染预览">
          <MarkdownBody content={markdown} />
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
