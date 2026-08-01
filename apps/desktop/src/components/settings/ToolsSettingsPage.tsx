import { CheckSquare, Square } from "lucide-react";
import {
  AVAILABLE_TOOLS,
  GODOT_TOOLS,
  type ClientPrefs,
} from "@shared/ipc";
import { useConfirm } from "../../lib/app-confirm";

type Props = {
  prefs: ClientPrefs;
  hasActiveSession: boolean;
  onToggleTool: (tool: string) => void;
  onPrefsChanged?: (prefs: ClientPrefs) => void;
  onOpenGodotSettings: () => void;
};

export function ToolsSettingsPage({
  prefs,
  hasActiveSession,
  onToggleTool,
  onPrefsChanged,
  onOpenGodotSettings,
}: Props) {
  const confirm = useConfirm();
  const allBuiltinToolsEnabled = AVAILABLE_TOOLS.every((tool) =>
    prefs.tools.includes(tool),
  );
  const allGodotEditorToolsEnabled = GODOT_TOOLS.every((tool) =>
    prefs.tools.includes(tool),
  );

  const setToolGroupEnabled = async (
    tools: readonly string[],
    enabled: boolean,
  ) => {
    if (hasActiveSession) {
      const ok = await confirm({
        title: "更改工具白名单",
        message: "会重建工具定义并清空本会话 API 缓存。确定继续？",
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
          Agent / 目标默认白名单；更改会清空本会话 API 缓存。
          调研 / Plan 模式另有只读硬闸（含 bash 只读分类器）。文件类工具受项目
          cwd 沙箱约束；bash 仍可能访问 cwd 外路径。
        </p>
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
              onClick={onOpenGodotSettings}
            >
              连接与 RPC 设置
            </button>
          </div>
        </div>
        <p className="modal-hint">需 RPC 已连接；默认关</p>
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
    </section>
  );
}
