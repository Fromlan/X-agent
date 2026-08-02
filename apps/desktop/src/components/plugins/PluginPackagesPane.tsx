import type { PluginsState } from "./usePluginsState";

interface Props {
  state: PluginsState;
}

export function PluginPackagesPane({ state }: Props) {
  const { packages, busy, uninstallPkg } = state;
  return (
    <>
      <aside className="plugins-list-pane">
        {packages.length === 0 ? (
          <p className="empty-state">
            尚无 Packages。安装后会出现在此列表（与 <code>pi list</code> 同源）。
          </p>
        ) : (
          <div className="plugins-list">
            {packages.map((pkg) => (
              <div
                key={`${pkg.name}-${pkg.source}`}
                className="plugin-item plugin-item--package"
              >
                <div className="plugin-item-body">
                  <div className="plugin-item-title" title={pkg.name}>
                    {pkg.name}
                  </div>
                  <div className="plugin-item-meta">
                    {[
                      pkg.skillCount != null
                        ? `${pkg.skillCount} 技能`
                        : null,
                      pkg.promptCount != null
                        ? `${pkg.promptCount} 提示词`
                        : null,
                      pkg.extensionCount != null
                        ? `${pkg.extensionCount} 扩展`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Package"}
                  </div>
                  <div className="plugin-item-meta" title={pkg.source}>
                    {pkg.source}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm plugin-item-action"
                  disabled={busy}
                  onClick={() => void uninstallPkg(pkg.source, pkg.name)}
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
          执行 <code>pi install</code>，包内技能 / 提示词会出现在对应页签。
          <code>godot-*</code> 技能仅在打开 Godot 项目时索引。
        </p>
        <div className="settings-toolbar">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => void state.installGodotPi()}
          >
            一键安装 X-agent 原生技能包
          </button>
        </div>
        <label className="field block-field">
          安装源
          <input
            value={state.packageSource}
            onChange={(e) => state.setPackageSource(e.target.value)}
            placeholder="D:/path/to/pkg 或 npm:@scope/name"
          />
        </label>
        <div className="settings-toolbar">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy || !state.packageSource.trim()}
            onClick={() => void state.installPkg(state.packageSource.trim())}
          >
            安装
          </button>
        </div>
      </section>
    </>
  );
}