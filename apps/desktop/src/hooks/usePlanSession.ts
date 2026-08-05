import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanFileLocation } from "@shared/ipc";
import { WRITE_PLAN_TOOL } from "@shared/mode-tools";
import { setRightPanelTab } from "../stores/right-panel-store";

export function isWritePlanTool(name: string): boolean {
  return name === WRITE_PLAN_TOOL;
}

export function planFileLabel(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

type UsePlanSessionOpts = {
  planPath: string | null;
  busy: boolean;
  onBuildPlan: () => void;
  onPlanPathChange?: (path: string | null) => void;
};

export function usePlanSession({
  planPath,
  busy,
  onBuildPlan,
  onPlanPathChange,
}: UsePlanSessionOpts) {
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
    setMarkdown("");
    setDirty(false);
    void (async () => {
      const res = await window.xAgent.plan.getContent();
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

  const save = useCallback(async (): Promise<boolean> => {
    if (!planPath) return false;
    setSaving(true);
    setError(null);
    setHint(null);
    try {
      const res = await window.xAgent.plan.saveContent(markdown);
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
  }, [markdown, planPath]);

  const saveToWorkspace = useCallback(async () => {
    if (!planPath) return;
    setSaving(true);
    setError(null);
    setHint(null);
    try {
      if (dirty) {
        const ok = await save();
        if (!ok) return;
      }
      const res = await window.xAgent.plan.saveToWorkspace();
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
  }, [dirty, onPlanPathChange, planPath, save]);

  const clear = useCallback(async () => {
    if (!planPath) return;
    setSaving(true);
    setError(null);
    setHint(null);
    try {
      const res = await window.xAgent.plan.clear();
      if (!res.ok) {
        setError(res.error ?? "清除失败");
        return;
      }
      onPlanPathChange?.(null);
    } finally {
      setSaving(false);
    }
  }, [onPlanPathChange, planPath]);

  const execute = useCallback(async () => {
    if (!planPath) return;
    setError(null);
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    onBuildPlan();
  }, [dirty, onBuildPlan, planPath, save]);

  const onMarkdownChange = useCallback((value: string) => {
    setMarkdown(value);
    setDirty(true);
    setHint(null);
  }, []);

  return {
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
    disabled: busy || saving,
  };
}

/** Open right-panel Plan tab when a new plan path appears. */
export function usePlanSessionAutoOpen(
  planPath: string | null,
  ensureRightPanelOpen: () => void | Promise<void>,
): void {
  const prevPlanPathRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevPlanPathRef.current;
    prevPlanPathRef.current = planPath;
    if (!planPath || planPath === prev) return;
    setRightPanelTab("plan");
    void ensureRightPanelOpen();
  }, [ensureRightPanelOpen, planPath]);
}
