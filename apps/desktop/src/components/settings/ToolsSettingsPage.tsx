import { CheckSquare, Square } from "lucide-react";
import {
  AVAILABLE_TOOLS,
  GODOT_DOCS_TOOLS,
  GODOT_TOOLS,
  type ClientPrefs,
} from "@shared/ipc";
import { useConfirm } from "../../lib/app-confirm";

type GodotSettingsSection = "editor" | "docs";

type Props = {
  prefs: ClientPrefs;
  hasActiveSession: boolean;
  onToggleTool: (tool: string) => void;
  onPrefsChanged?: (prefs: ClientPrefs) => void;
  onOpenGodotSection: (section: GodotSettingsSection) => void;
};

export function ToolsSettingsPage({
  prefs,
  hasActiveSession,
  onToggleTool,
  onPrefsChanged,
  onOpenGodotSection,
}: Props) {
  const confirm = useConfirm();
  const allBuiltinToolsEnabled = AVAILABLE_TOOLS.every((tool) =>
    prefs.tools.includes(tool),
  );
  const allGodotEditorToolsEnabled = GODOT_TOOLS.every((tool) =>
    prefs.tools.includes(tool),
  );
  const allGodotDocsToolsEnabled = GODOT_DOCS_TOOLS.every((tool) =>
    prefs.tools.includes(tool),
  );

  const setToolGroupEnabled = async (
    tools: readonly string[],
    enabled: boolean,
  ) => {
    if (hasActiveSession) {
      const ok = await confirm({
        title: "更改工具白名单",
        message:
          "更改工具白名单会重建当前会话的系统提示与工具定义，导致 DeepSeek/API 前缀缓存失效（本会话后续轮次需重新积累命中）。\n\n确定继续？",
        confirmLabel: "继续",
        tone: "warn",
      });
      if (!ok) return;
    }
    const withoutGroup = prefs.tools.filter((tool) => !tools.includes(tool));
    const nextTools = enabled ? [...withoutGroup, ...tools] : withoutGroup;
    const next = await window.xAgent.setPrefs({ tools: nextTools });
    onPrefsChanged?.(next);
  };

  return (
    <section className="settings-page">
      <div className="settings-page-head">
        <h3>启用工具</h3>
        <p className="modal-hint">
          更改会立即应用到当前会话（若已打开项目），并重建系统提示与工具定义 —
          这会清空本会话的 API
          前缀缓存命中。长会话请尽量在新会话前调好白名单。右侧「工具」面板显示已启用列表；实际调用记录在
          Agent 运行后出现。
        </p>
      </div>

      <div className="settings-block">
        <h4 className="settings-block-title">快捷档</h4>
        <p className="modal-hint">
          「只读安全档」关闭 bash / write / edit，降低 Agent 对文件系统与终端的影响；Godot
          工具不受影响。
        </p>
        <div className="settings-inline-row">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              void (async () => {
                const safe = AVAILABLE_TOOLS.filter(
                  (t) => t !== "bash" && t !== "write" && t !== "edit",
                );
                const keepExtra = prefs.tools.filter(
                  (t) => !(AVAILABLE_TOOLS as readonly string[]).includes(t),
                );
                if (hasActiveSession) {
                  const ok = await confirm({
                    title: "应用只读安全档",
                    message:
                      "将关闭 bash / write / edit。更改工具白名单会重建系统提示并清空本会话前缀缓存。\n\n确定继续？",
                    confirmLabel: "继续",
                    tone: "warn",
                  });
                  if (!ok) return;
                }
                const next = await window.xAgent.setPrefs({
                  tools: [...safe, ...keepExtra],
                });
                onPrefsChanged?.(next);
              })();
            }}
          >
            只读安全档
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              void setToolGroupEnabled(AVAILABLE_TOOLS, true);
            }}
          >
            恢复内置全开
          </button>
        </div>
      </div>

      <div className="settings-block">
        <div className="settings-block-head">
          <h4 className="settings-block-title">内置</h4>
          <button
            type="button"
            className="btn btn-ghost btn-sm settings-link-btn"
            title={allBuiltinToolsEnabled ? "全部关闭" : "全部开启"}
            aria-label={allBuiltinToolsEnabled ? "全部关闭" : "全部开启"}
            onClick={() => {
              void setToolGroupEnabled(AVAILABLE_TOOLS, !allBuiltinToolsEnabled);
            }}
          >
            {allBuiltinToolsEnabled ? (
              <CheckSquare size={14} />
            ) : (
              <Square size={14} />
            )}
          </button>
        </div>
        <div className="tool-grid">
          {AVAILABLE_TOOLS.map((tool) => {
            const checked = prefs.tools.includes(tool);
            return (
              <label key={tool} className="tool-check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleTool(tool)}
                />
                <span>{tool}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="settings-block">
        <div className="settings-block-head">
          <h4 className="settings-block-title">Godot 编辑器</h4>
          <div className="settings-toolbar">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              title={allGodotEditorToolsEnabled ? "全部关闭" : "全部开启"}
              aria-label={
                allGodotEditorToolsEnabled ? "全部关闭" : "全部开启"
              }
              onClick={() => {
                void setToolGroupEnabled(
                  GODOT_TOOLS,
                  !allGodotEditorToolsEnabled,
                );
              }}
            >
              {allGodotEditorToolsEnabled ? (
                <CheckSquare size={14} />
              ) : (
                <Square size={14} />
              )}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm settings-link-btn"
              onClick={() => onOpenGodotSection("editor")}
            >
              连接与 RPC 设置
            </button>
          </div>
        </div>
        <p className="modal-hint">需启用 RPC 插件并连接桌面桥；默认关闭。</p>
        <div className="tool-grid">
          {GODOT_TOOLS.map((tool) => {
            const checked = prefs.tools.includes(tool);
            return (
              <label key={tool} className="tool-check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleTool(tool)}
                />
                <span>{tool}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="settings-block">
        <div className="settings-block-head">
          <h4 className="settings-block-title">Godot 文档</h4>
          <div className="settings-toolbar">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              title={allGodotDocsToolsEnabled ? "全部关闭" : "全部开启"}
              aria-label={allGodotDocsToolsEnabled ? "全部关闭" : "全部开启"}
              onClick={() => {
                void setToolGroupEnabled(
                  GODOT_DOCS_TOOLS,
                  !allGodotDocsToolsEnabled,
                );
              }}
            >
              {allGodotDocsToolsEnabled ? (
                <CheckSquare size={14} />
              ) : (
                <Square size={14} />
              )}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm settings-link-btn"
              onClick={() => onOpenGodotSection("docs")}
            >
              文档缓存设置
            </button>
          </div>
        </div>
        <p className="modal-hint">
          离线检索官方 godot-docs；需先导入 zip。默认关闭。
        </p>
        <div className="tool-grid">
          {GODOT_DOCS_TOOLS.map((tool) => {
            const checked = prefs.tools.includes(tool);
            return (
              <label key={tool} className="tool-check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleTool(tool)}
                />
                <span>{tool}</span>
              </label>
            );
          })}
        </div>
      </div>
    </section>
  );
}
