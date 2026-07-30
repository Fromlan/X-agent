import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FilePlus2,
  FolderOpen,
  Puzzle,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import type {
  InstalledPackageInfo,
  PluginItem,
  PluginKind,
  PluginScope,
} from "@shared/ipc";
import { SelectMenu } from "./SelectMenu";
import { SettingsNotice, useAutoClearNotice } from "./SettingsNotice";
import { useConfirm } from "@/lib/app-confirm";

interface Props {
  cwd: string | null;
}

type ScopeFilter = "all" | PluginScope;
type PageKind = PluginKind | "package";

const KIND_TABS: { kind: PageKind; label: string }[] = [
  { kind: "prompt", label: "提示词" },
  { kind: "skill", label: "技能" },
  { kind: "extension", label: "扩展" },
  { kind: "theme", label: "主题" },
  { kind: "package", label: "Packages" },
];

function kindLabel(kind: PluginKind): string {
  if (kind === "prompt") return "提示词";
  if (kind === "skill") return "技能";
  if (kind === "extension") return "扩展";
  return "主题";
}

export function PluginsPage({ cwd }: Props) {
  const confirm = useConfirm();
  const [kind, setKind] = useState<PageKind>("prompt");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [items, setItems] = useState<PluginItem[]>([]);
  const [packages, setPackages] = useState<InstalledPackageInfo[]>([]);
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
  const [packageSource, setPackageSource] = useState("");

  const dirty = content !== baseline;
  const isPackageTab = kind === "package";

  useAutoClearNotice(message, () => setMessage(null), 4500, !error);

  const filtered = useMemo(() => {
    if (isPackageTab) return [];
    return items.filter((item) => {
      if (item.kind !== kind) return false;
      if (scopeFilter === "all") return true;
      return item.scope === scopeFilter;
    });
  }, [items, kind, scopeFilter, isPackageTab]);

  const selected = useMemo(
    () => items.find((i) => i.path === selectedPath) ?? null,
    [items, selectedPath],
  );

  const refresh = useCallback(async () => {
    const [list, pkgs] = await Promise.all([
      window.xAgent.listPlugins(cwd),
      window.xAgent.listInstalledPackages(),
    ]);
    setItems(list);
    setPackages(pkgs);
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
    if (isPackageTab) {
      setSelectedPath(null);
      setContent("");
      setBaseline("");
      setWarnings([]);
      return;
    }
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
  }, [filtered, openItem, selectedPath, isPackageTab]);

  const save = async () => {
    if (!selectedPath) return;
    setBusy(true);
    setError(null);
    const result = await window.xAgent.writePlugin(selectedPath, content);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "保存失败");
      return;
    }
    setBaseline(content);
    setWarnings(result.warnings ?? []);
    setMessage("已保存");
    await refresh();
    await window.xAgent.reloadResources();
  };

  const create = async () => {
    if (isPackageTab) return;
    setBusy(true);
    setError(null);
    const result = await window.xAgent.createPlugin({
      kind: kind as PluginKind,
      scope: createScope,
      name: createName.trim(),
      cwd,
    });
    setBusy(false);
    if (!result.ok || !result.item) {
      setError(result.error ?? "创建失败");
      return;
    }
    setCreateOpen(false);
    setCreateName("");
    setMessage(`已创建 ${result.item.name}`);
    await refresh();
    await openItem(result.item);
    await window.xAgent.reloadResources();
  };

  const remove = async () => {
    if (!selected) return;
    const ok = await confirm({
      title: "删除插件",
      message: `删除 ${selected.name}？此操作不可撤销。`,
      confirmLabel: "删除",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    const result = await window.xAgent.deletePlugin(selected.path);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "删除失败");
      return;
    }
    setMessage("已删除");
    setSelectedPath(null);
    await refresh();
    await window.xAgent.reloadResources();
  };

  const installPkg = async (source: string) => {
    setBusy(true);
    setError(null);
    const result = await window.xAgent.installPackage(source);
    setBusy(false);
    if (!result.ok) {
      setError(
        [result.error, result.output].filter(Boolean).join("\n") || "安装失败",
      );
      return;
    }
    setKind("package");
    const counts = result.package
      ? [
          result.package.skillCount != null
            ? `${result.package.skillCount} 技能`
            : null,
          result.package.promptCount != null
            ? `${result.package.promptCount} 提示词`
            : null,
          result.package.extensionCount != null
            ? `${result.package.extensionCount} 扩展`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
    setMessage(
      `已安装 ${result.package?.name ?? source}${counts ? `（${counts}，可在对应页签查看）` : ""}`,
    );
    setPackageSource("");
    await refresh();
    await window.xAgent.reloadResources();
  };

  const installGodotPi = async () => {
    setBusy(true);
    setError(null);
    const result = await window.xAgent.installGodotPiPackage();
    setBusy(false);
    if (!result.ok) {
      setError(
        [result.error, result.output].filter(Boolean).join("\n") || "安装失败",
      );
      return;
    }
    setKind("package");
    const counts = result.package
      ? [
          result.package.skillCount != null
            ? `${result.package.skillCount} 技能`
            : null,
          result.package.promptCount != null
            ? `${result.package.promptCount} 提示词`
            : null,
          result.package.extensionCount != null
            ? `${result.package.extensionCount} 扩展`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
    setMessage(
      `已安装 X-agent 原生技能包：${result.package?.name ?? ""}${counts ? `（${counts}，可在「技能 / 提示词 / 扩展」页签查看）` : ""}`,
    );
    await refresh();
    await window.xAgent.reloadResources();
  };

  return (
    <div className="plugins-page plugins-page--embedded">
      <header className="plugins-toolbar">
        <div className="plugins-title">
          <Puzzle size={16} />
          <span>Pi 插件</span>
        </div>
        <div className="plugins-toolbar-right">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} />
            刷新
          </button>
          {!isPackageTab && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy}
              onClick={() => {
                setCreateScope(cwd ? "project" : "global");
                setCreateOpen(true);
              }}
            >
              <FilePlus2 size={14} />
              新建
            </button>
          )}
        </div>
      </header>

      <div className="plugins-tabs">
        {KIND_TABS.map((tab) => (
          <button
            key={tab.kind}
            type="button"
            className={`plugins-tab${kind === tab.kind ? " active" : ""}`}
            onClick={() => {
              setKind(tab.kind);
              setMessage(null);
              setError(null);
            }}
          >
            {tab.label}
          </button>
        ))}
        {!isPackageTab && (
          <div className="plugins-scope">
            <button
              type="button"
              className={scopeFilter === "all" ? "active" : ""}
              onClick={() => setScopeFilter("all")}
            >
              全部
            </button>
            <button
              type="button"
              className={scopeFilter === "global" ? "active" : ""}
              onClick={() => setScopeFilter("global")}
            >
              全局
            </button>
            <button
              type="button"
              className={scopeFilter === "project" ? "active" : ""}
              onClick={() => setScopeFilter("project")}
              disabled={!cwd}
            >
              项目
            </button>
          </div>
        )}
      </div>

      {(message || error) && (
        <SettingsNotice
          text={(error ?? message)!}
          tone={error ? "error" : "warn"}
          onDismiss={() => {
            setMessage(null);
            setError(null);
          }}
        />
      )}

      <div className="plugins-body">
        {isPackageTab ? (
          <>
            <aside className="plugins-list-pane">
              {packages.length === 0 ? (
                <p className="empty-state">
                  尚无 Packages。安装后会出现在此列表（与 <code>pi list</code>{" "}
                  同源）。
                </p>
              ) : (
                <div className="plugins-list">
                {packages.map((pkg) => (
                  <div key={`${pkg.name}-${pkg.source}`} className="plugin-item">
                    <div className="plugin-item-title">{pkg.name}</div>
                    <div className="plugin-item-meta" title={pkg.source}>
                      {[
                        pkg.skillCount != null ? `${pkg.skillCount} 技能` : null,
                        pkg.promptCount != null
                          ? `${pkg.promptCount} 提示词`
                          : null,
                        pkg.extensionCount != null
                          ? `${pkg.extensionCount} 扩展`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || pkg.source}
                    </div>
                    <div className="plugin-item-meta" title={pkg.source}>
                      {pkg.source}
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={async () => {
                        const ok = await confirm({
                          title: "卸载 Packages",
                          message: `卸载 ${pkg.name}？将执行 pi uninstall 并从设置中移除该包。`,
                          confirmLabel: "卸载",
                          tone: "danger",
                        });
                        if (!ok) return;
                        setBusy(true);
                        const res = await window.xAgent.uninstallPackage(
                          pkg.source,
                        );
                        setBusy(false);
                        if (!res.ok) setError(res.error ?? "卸载失败");
                        else {
                          setMessage("已卸载");
                          setError(null);
                          await refresh();
                        }
                      }}
                    >
                      卸载
                    </button>
                  </div>
                ))}
                </div>
              )}
            </aside>
            <section className="plugins-editor-pane">
              <h3>安装 Package</h3>
              <p className="modal-hint">
                通过全局 Pi CLI 执行 <code>pi install &lt;source&gt;</code>
                ，写入 <code>~/.pi/agent/settings.json</code>。包内技能 /
                提示词 / 扩展会出现在对应页签（只读），Agent 会话也会自动加载。
                原生技能包含通用 Core；<code>godot-*</code> 技能仅在打开
                Godot 项目（存在 <code>project.godot</code>）时进入索引。应用启动时也会尝试自动安装。
              </p>
              <div className="settings-toolbar">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={() => void installGodotPi()}
                >
                  一键安装 X-agent 原生技能包
                </button>
              </div>
              <label className="field block-field">
                安装源
                <input
                  value={packageSource}
                  onChange={(e) => setPackageSource(e.target.value)}
                  placeholder="D:/path/to/pkg 或 npm:@scope/name"
                />
              </label>
              <div className="settings-toolbar">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy || !packageSource.trim()}
                  onClick={() => void installPkg(packageSource.trim())}
                >
                  安装
                </button>
              </div>
            </section>
          </>
        ) : (
          <>
            <aside className="plugins-list-pane">
              {filtered.length === 0 ? (
                <p className="empty-state">
                  暂无{kindLabel(kind)}插件。
                  {packages.length > 0 && kind !== "theme"
                    ? " 若刚安装了 Package，点「刷新」；包内资源会标 Package。"
                    : null}
                </p>
              ) : (
                <div className="plugins-list">
                {filtered.map((item) => (
                  <button
                    key={`${item.id}:${item.path}`}
                    type="button"
                    className={`plugin-item${
                      selectedPath === item.path ? " active" : ""
                    }`}
                    onClick={() => void openItem(item)}
                  >
                    <div className="plugin-item-title">{item.name}</div>
                    <div className="plugin-item-meta">
                      {item.packageName
                        ? `Package · ${item.packageName}`
                        : item.scope === "global"
                          ? "全局"
                          : "项目"}
                      {item.description && !item.packageName
                        ? ` · ${item.description}`
                        : ""}
                    </div>
                  </button>
                ))}
                </div>
              )}
            </aside>

            <section className="plugins-editor-pane">
              {!selected ? (
                <p className="empty-state">选择左侧插件进行编辑</p>
              ) : (
                <>
                  <div className="plugins-editor-meta">
                    <div className="plugins-editor-meta-text">
                      <h2>{selected.name}</h2>
                      <p className="plugins-editor-path" title={selected.path}>
                        {selected.path}
                      </p>
                    </div>
                    <div className="plugins-editor-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void window.xAgent.revealPlugin(selected.path)}
                      >
                        <FolderOpen size={13} />
                        打开位置
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy || !selected.editable}
                        title={
                          selected.editable
                            ? "删除"
                            : "来自 Package，请用 pi remove 卸载包"
                        }
                        onClick={() => void remove()}
                      >
                        <Trash2 size={13} />
                        删除
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busy || !dirty || !selected.editable}
                        title={
                          selected.editable
                            ? "保存"
                            : "来自 Package，只读预览"
                        }
                        onClick={() => void save()}
                      >
                        <Save size={13} />
                        保存
                      </button>
                    </div>
                  </div>
                  {!selected.editable && (
                    <div className="banner warn">
                      只读：来自已安装 Package
                      {selected.packageName ? `（${selected.packageName}）` : ""}
                      。Agent 会加载这些资源；卸载请用终端{" "}
                      <code>pi remove</code>。
                    </div>
                  )}
                  {warnings.length > 0 && (
                    <div className="banner warn">
                      校验警告：{warnings.join("；")}
                    </div>
                  )}
                  <textarea
                    className="plugins-editor"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    spellCheck={false}
                    readOnly={!selected.editable}
                  />
                </>
              )}
            </section>
          </>
        )}
      </div>

      <footer className="plugins-footer">
        文档：pi.dev/docs/latest · 仓库 Pi插件指导文档.md
      </footer>

      {createOpen && !isPackageTab && (
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
              <h2>新建{kindLabel(kind)}</h2>
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
              <div className="field block-field">
                作用域
                <SelectMenu
                  variant="block"
                  value={createScope}
                  options={[
                    { value: "global", label: "全局 ~/.pi/agent" },
                    {
                      value: "project",
                      label: `项目 .pi${!cwd ? "（需先打开项目）" : ""}`,
                      disabled: !cwd,
                    },
                  ]}
                  onChange={(v) => setCreateScope(v as PluginScope)}
                  aria-label="作用域"
                />
              </div>
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
