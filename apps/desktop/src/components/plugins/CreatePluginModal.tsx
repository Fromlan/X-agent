import { PluginScope } from "@shared/ipc";
import { SelectMenu } from "../SelectMenu";
import { kindLabel } from "./types";
import type { PluginsState } from "./usePluginsState";

interface Props {
  state: PluginsState;
  cwd: string | null;
}

export function CreatePluginModal({ state, cwd }: Props) {
  const { createOpen, setCreateOpen, createName, setCreateName, createScope, setCreateScope, busy, kind, create } = state;
  if (!createOpen) return null;
  return (
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
          <h2>新建{kindLabel(kind as "prompt" | "skill" | "extension" | "theme")}</h2>
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
  );
}