import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  FilePlus2,
  FolderOpen,
  Puzzle,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import type {
  PluginItem,
  PluginKind,
  PluginScope,
} from "@shared/ipc";

interface Props {
  cwd: string | null;
  onBack: () => void;
}

type ScopeFilter = "all" | PluginScope;

const KIND_TABS: { kind: PluginKind; label: string }[] = [
  { kind: "prompt", label: "提示词" },
  { kind: "skill", label: "技能" },
  { kind: "extension", label: "扩展" },
];

export function PluginsPage({ cwd, onBack }: Props) {
  const [kind, setKind] = useState<PluginKind>("prompt");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [items, setItems] = useState<PluginItem[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [baseline, setBaseline] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createScope, setCreateScope] = useState<PluginScope>("global");

  const dirty = content !== baseline;

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (item.kind !== kind) return false;
      if (scopeFilter === "all") return true;
      return item.scope === scopeFilter;
    });
  }, [items, kind, scopeFilter]);

  const selected = useMemo(
    () => items.find((i) => i.path === selectedPath) ?? null,
    [items, selectedPath],
  );

  const refresh = useCallback(async () => {
    const list = await window.xAgent.listPlugins(cwd);
    setItems(list);
  }, [cwd]);

  const openItem = useCallback(async (item: PluginItem) => {
    setSelectedPath(item.path);
    setError(null);
    setMessage(null);
    const result = await window.xAgent.readPlugin(item.path);
    if (!result.ok) {
      setError(result.error ?? "读取失败");
      setContent("");
      setBaseline("");
      setWarnings([]);
      return;
    }
    setContent(result.content ?? "");
    setBaseline(result.content ?? "");
    setWarnings(result.warnings ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const first = filtered[0];
    if (!first) {
      setSelectedPath(null);
      setContent("");
      setBaseline("");
      setWarnings([]);
      return;
    }
    if (!selectedPath || !filtered.some((i) => i.path === selectedPath)) {
      void openItem(first);
    }
  }, [filtered, openItem, selectedPath]);

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.xAgent.writePlugin(selected.path, content);
      if (!result.ok) {
        setError(result.error ?? "保存失败");
        return;
      }
      setBaseline(content);
      setWarnings(result.warnings ?? []);
      setMessage(
        result.warnings?.length
          ? `已保存（警告：${result.warnings.join("；")}）`
          : "已保存并尝试重载资源",
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    if (!window.confirm(`删除「${selected.name}」？此操作不可撤销。`)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.xAgent.deletePlugin(selected.path);
      if (!result.ok) {
        setError(result.error ?? "删除失败");
        return;
      }
      setSelectedPath(null);
      setContent("");
      setBaseline("");
      setMessage("已删除");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.xAgent.createPlugin({
        kind,
        scope: createScope,
        name: createName.trim(),
        cwd,
      });
      if (!result.ok || !result.item) {
        setError(result.error ?? "创建失败");
        return;
      }
      setCreateOpen(false);
      setCreateName("");
      setMessage(`已创建 ${result.item.name}`);
      await refresh();
      await openItem(result.item);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="plugins-page">
      <header className="plugins-toolbar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowLeft size={14} />
          返回聊天
        </button>
        <div className="plugins-title">
          <Puzzle size={14} />
          插件管理
        </div>
        <div className="plugins-toolbar-right">
          <label className="field">
            作用域
            <select
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value as ScopeFilter)}
            >
              <option value="all">全部</option>
              <option value="global">全局</option>
              <option value="project" disabled={!cwd}>
                项目{!cwd ? "（先打开项目）" : ""}
              </option>
            </select>
          </label>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void refresh()}
            title="刷新"
          >
            <RefreshCw size={13} />
            刷新
          </button>
        </div>
      </header>

      <div className="plugins-tabs">
        {KIND_TABS.map((tab) => (
          <button
            key={tab.kind}
            type="button"
            className={
              kind === tab.kind ? "plugins-tab active" : "plugins-tab"
            }
            onClick={() => setKind(tab.kind)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {(error || message) && (
        <div className={`banner ${error ? "error" : "warn"}`}>
          {error ?? message}
        </div>
      )}

      <div className="plugins-body">
        <aside className="plugins-list-pane">
          <div className="plugins-list-head">
            <span>
              {kind === "prompt"
                ? "提示词模板"
                : kind === "skill"
                  ? "Skills"
                  : "Extensions"}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setCreateScope(cwd ? "project" : "global");
                setCreateOpen(true);
              }}
            >
              <FilePlus2 size={13} />
              新建
            </button>
          </div>
          <ul className="plugins-list">
            {filtered.length === 0 && (
              <li className="session-empty">暂无条目</li>
            )}
            {filtered.map((item) => (
              <li key={item.path}>
                <button
                  type="button"
                  className={
                    item.path === selectedPath
                      ? "plugin-item active"
                      : "plugin-item"
                  }
                  onClick={() => void openItem(item)}
                >
                  <div className="plugin-item-title">{item.name}</div>
                  <div className="plugin-item-meta">
                    {item.scope === "global" ? "全局" : "项目"}
                    {item.description ? ` · ${item.description}` : ""}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="plugins-editor-pane">
          {!selected ? (
            <div className="empty-state">选择左侧条目进行编辑，或新建一个。</div>
          ) : (
            <>
              <div className="plugins-editor-meta">
                <div>
                  <div className="plugins-editor-name">{selected.name}</div>
                  <div className="plugins-editor-path" title={selected.path}>
                    {selected.path}
                  </div>
                </div>
                <div className="plugins-editor-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void window.xAgent.revealPlugin(selected.path)}
                  >
                    <FolderOpen size={13} />
                    打开目录
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={busy}
                    onClick={() => void remove()}
                  >
                    <Trash2 size={13} />
                    删除
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy || !dirty}
                    onClick={() => void save()}
                  >
                    <Save size={13} />
                    保存
                  </button>
                </div>
              </div>
              {warnings.length > 0 && (
                <div className="banner warn">Frontmatter 警告：{warnings.join("；")}</div>
              )}
              <textarea
                className="plugins-editor"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
              />
            </>
          )}
        </section>
      </div>

      <footer className="plugins-footer">
        Themes / Packages 管理尚未接入。文档：pi.dev/docs/latest · 仓库 Pi插件指导文档.md
      </footer>

      {createOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setCreateOpen(false)}
        >
          <div
            className="modal-panel"
            role="dialog"
            aria-label="新建插件"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>
                新建
                {kind === "prompt"
                  ? "提示词"
                  : kind === "skill"
                    ? "技能"
                    : "扩展"}
              </h2>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setCreateOpen(false)}
              >
                关闭
              </button>
            </div>
            <div className="modal-body">
              <label className="field block-field">
                名称
                <input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="my-name"
                  autoFocus
                />
              </label>
              <label className="field block-field">
                作用域
                <select
                  value={createScope}
                  onChange={(e) =>
                    setCreateScope(e.target.value as PluginScope)
                  }
                >
                  <option value="global">全局 ~/.pi/agent</option>
                  <option value="project" disabled={!cwd}>
                    项目 .pi{!cwd ? "（需先打开项目）" : ""}
                  </option>
                </select>
              </label>
              <p className="modal-hint">
                名称：1–64 位小写字母、数字、连字符（不能首尾为连字符）
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !createName.trim()}
                  onClick={() => void create()}
                >
                  创建
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
