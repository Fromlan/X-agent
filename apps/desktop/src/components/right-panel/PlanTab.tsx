import { useEffect, useState } from "react";
import { FolderInput, Hammer, Loader2, Save, X } from "lucide-react";
import type { PlanFileLocation } from "@shared/ipc";

interface Props {
  planPath: string | null;
  busy: boolean;
  onBuildPlan: () => void;
  onPlanPathChange?: (path: string | null) => void;
}

function planFileLabel(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

export function PlanTab({
  planPath,
  busy,
  onBuildPlan,
  onPlanPathChange,
}: Props) {
  const [markdown, setMarkdown] = useState("");
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [location, setLocation] = useState<PlanFileLocation | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!planPath) {
      setMarkdown("");
      setLoadedPath(null);
      setLocation(null);
      setDirty(false);
      setError(null);
      setHint(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const res = await window.xAgent.getPlanContent();
      if (cancelled) return;
      setLoading(false);
      if (!res.ok || res.markdown == null || !res.path) {
        setError(res.error ?? "无法读取计划");
        return;
      }
      setMarkdown(res.markdown);
      setLoadedPath(res.path);
      setLocation(res.location ?? null);
      setDirty(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [planPath]);

  const save = async (): Promise<boolean> => {
    if (!planPath) return false;
    setSaving(true);
    setError(null);
    setHint(null);
    try {
      const res = await window.xAgent.savePlanContent(markdown);
      if (!res.ok) {
        setError(res.error ?? "保存失败");
        return false;
      }
      setDirty(false);
      setHint("已保存");
      if (res.path) setLoadedPath(res.path);
      if (res.location) setLocation(res.location);
      return true;
    } finally {
      setSaving(false);
    }
  };

  const saveToWorkspace = async () => {
    if (!planPath) return;
    setSaving(true);
    setError(null);
    setHint(null);
    try {
      if (dirty) {
        const ok = await save();
        if (!ok) return;
      }
      const res = await window.xAgent.savePlanToWorkspace();
      if (!res.ok) {
        setError(res.error ?? "保存到项目失败");
        return;
      }
      setLocation("workspace");
      if (res.path) {
        setLoadedPath(res.path);
        onPlanPathChange?.(res.path);
      }
      setHint("已保存到项目 .pi/plans/");
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const clearPlan = async () => {
    if (!planPath) return;
    setSaving(true);
    setError(null);
    setHint(null);
    try {
      const res = await window.xAgent.clearPlan();
      if (!res.ok) {
        setError(res.error ?? "清除失败");
        return;
      }
      onPlanPathChange?.(null);
    } finally {
      setSaving(false);
    }
  };

  const execute = async () => {
    if (!planPath) return;
    setError(null);
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    onBuildPlan();
  };

  if (!planPath) {
    return (
      <div className="rp-plan-empty">
        <p>尚无计划文件。</p>
        <p className="rp-muted">
          切换到 Plan 模式，让 Agent 研究后调用 write_plan。生成后可在此编辑；切换
          Agent / 目标模式不会丢失当前计划。
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
            setMarkdown(e.target.value);
            setDirty(true);
            setHint(null);
          }}
          spellCheck={false}
          disabled={busy || saving}
          aria-label="计划 Markdown"
        />
      )}
      {error && <div className="rp-plan-error">{error}</div>}
      {hint && !error && <div className="rp-plan-hint">{hint}</div>}
      <div className="rp-plan-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy || saving || loading || !dirty}
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
          disabled={busy || saving || loading || location === "workspace"}
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
          disabled={busy || saving || loading}
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
          disabled={busy || saving || loading}
          title="清除会话中的计划引用（不删除磁盘文件）"
          onClick={() => {
            void clearPlan();
          }}
        >
          <X size={14} aria-hidden />
          清除引用
        </button>
      </div>
    </div>
  );
}
