import { Check, ChevronDown, ChevronUp, ListChecks, X } from "lucide-react";
import { useState } from "react";
import type { ReadyItem } from "../lib/ready-checklist";

export type SettingsTabTarget =
  | "general"
  | "providers"
  | "tools"
  | "godot"
  | "plugins"
  | "usage";

type Props = {
  items: ReadyItem[];
  collapsed?: boolean;
  title?: string;
  notice?: string | null;
  piCliInstalling?: boolean;
  onDismiss: () => void;
  onDismissNotice?: () => void;
  onOpenSettings: (tab: SettingsTabTarget, godotSection?: "editor" | "docs") => void;
  onInstallPiCli?: () => void;
  onOpenPiLogin?: () => void;
  onApplyBash?: () => void;
  onInstallRpcAddon?: () => void;
  onStartRpcBridge?: () => void;
  onLaunchGodotEditor?: () => void;
  onEnableGodotTools?: () => void;
  busy?: boolean;
};

function actionForItem(
  item: ReadyItem,
  props: Props,
): { label: string; onClick: () => void } | null {
  if (item.done) return null;

  const kind =
    item.actionKind ??
    (item.id === "rpcBridge"
      ? "startBridge"
      : item.id === "rpcAddon"
        ? "installAddon"
        : item.id === "godotTools"
          ? "enableGodotTools"
          : item.id === "piCli"
            ? "installPi"
            : item.id === "bash"
              ? "applyBash"
              : item.id === "auth" || item.id === "models"
                ? "openSettings"
                : "openSettings");

  switch (kind) {
    case "installPi":
      if (props.onInstallPiCli) {
        return {
          label: props.piCliInstalling ? "安装中…" : "安装 Pi CLI",
          onClick: props.onInstallPiCli,
        };
      }
      break;
    case "openPiLogin":
      if (props.onOpenPiLogin) {
        return { label: "打开 Pi 登录", onClick: props.onOpenPiLogin };
      }
      break;
    case "applyBash":
      if (props.onApplyBash) {
        return { label: "写入 shellPath", onClick: props.onApplyBash };
      }
      break;
    case "installAddon":
      if (props.onInstallRpcAddon) {
        return { label: "安装插件", onClick: props.onInstallRpcAddon };
      }
      break;
    case "startBridge":
      if (props.onStartRpcBridge) {
        return { label: "启动桥接", onClick: props.onStartRpcBridge };
      }
      break;
    case "launchEditor":
      if (props.onLaunchGodotEditor) {
        return { label: "启动编辑器", onClick: props.onLaunchGodotEditor };
      }
      if (item.settingsTab) {
        return {
          label: "Godot 设置",
          onClick: () =>
            props.onOpenSettings(item.settingsTab!, item.godotSection),
        };
      }
      break;
    case "enableGodotTools":
      if (props.onEnableGodotTools) {
        return { label: "一键启用", onClick: props.onEnableGodotTools };
      }
      break;
    case "openSettings":
    default:
      break;
  }

  if (item.settingsTab) {
    return {
      label: item.id === "auth" ? "配置供应商" : "前往设置",
      onClick: () =>
        props.onOpenSettings(item.settingsTab!, item.godotSection),
    };
  }
  return null;
}

export function ReadyChecklist(props: Props) {
  const pending = props.items.filter((i) => !i.done);
  const blocking = pending.filter((i) => !i.optional);
  const doneCount = props.items.filter((i) => i.done).length;
  const total = props.items.length;

  const [open, setOpen] = useState(
    props.collapsed === true ? false : blocking.length > 1,
  );

  if (props.items.length === 0 || pending.length === 0) return null;

  const next = blocking[0] ?? pending[0]!;
  const nextAction = actionForItem(next, props);
  const title =
    props.title ??
    (blocking.length > 0
      ? `还需 ${blocking.length} 步`
      : `${pending.length} 项可选`);

  return (
    <div
      className={`ready-strip${blocking.length === 0 ? " is-optional-only" : ""}`}
      role="region"
      aria-label="项目就绪清单"
    >
      <div className="ready-strip-bar">
        <span className="ready-strip-icon" aria-hidden>
          <ListChecks size={14} strokeWidth={2} />
        </span>
        <button
          type="button"
          className="ready-strip-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="ready-strip-title">{title}</span>
          {!open && (
            <span className="ready-strip-next">{next.label}</span>
          )}
          <span className="ready-strip-progress">
            {doneCount}/{total}
          </span>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {!open && nextAction && (
          <button
            type="button"
            className="btn btn-secondary btn-sm ready-strip-cta"
            disabled={props.busy || props.piCliInstalling}
            onClick={(e) => {
              e.stopPropagation();
              nextAction.onClick();
            }}
          >
            {nextAction.label}
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon ready-strip-dismiss"
          title="暂时隐藏"
          aria-label="暂时隐藏就绪清单"
          onClick={props.onDismiss}
        >
          <X size={14} />
        </button>
      </div>

      {props.notice && (
        <div className="ready-strip-notice" role="status">
          <span>{props.notice}</span>
          {props.onDismissNotice && (
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon"
              aria-label="关闭提示"
              onClick={props.onDismissNotice}
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {open && (
        <ul className="ready-strip-list">
          {pending.map((item) => {
            const action = actionForItem(item, props);
            return (
              <li
                key={item.id}
                className={`ready-strip-item${item.optional ? " is-optional" : ""}`}
              >
                <span className="ready-strip-mark" aria-hidden>
                  <span className="ready-strip-dot" />
                </span>
                <div className="ready-strip-body">
                  <div className="ready-strip-label">
                    {item.label}
                    {item.optional && (
                      <span className="ready-strip-tag">可选</span>
                    )}
                  </div>
                  {item.detail && (
                    <div className="ready-strip-detail">{item.detail}</div>
                  )}
                </div>
                {action && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={props.busy || props.piCliInstalling}
                    onClick={(e) => {
                      e.stopPropagation();
                      action.onClick();
                    }}
                  >
                    {action.label}
                  </button>
                )}
              </li>
            );
          })}
          {doneCount > 0 && (
            <li className="ready-strip-item is-done-summary">
              <span className="ready-strip-mark" aria-hidden>
                <Check size={12} strokeWidth={2.5} />
              </span>
              <div className="ready-strip-body">
                <div className="ready-strip-label">
                  已完成 {doneCount} 项
                </div>
              </div>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

type NudgeProps = {
  visible: boolean;
  busy?: boolean;
  onEnable: () => void;
  onDismiss: () => void;
  onOpenSettings: () => void;
};

/** Compact nudge when Godot bridge is connected but editor tools are still off. */
export function GodotToolsNudge(props: NudgeProps) {
  if (!props.visible) return null;
  return (
    <div className="ready-strip godot-tools-nudge" role="status">
      <div className="ready-strip-bar">
        <span className="ready-strip-icon" aria-hidden>
          <ListChecks size={14} strokeWidth={2} />
        </span>
        <span className="ready-strip-title">Godot 已连接</span>
        <span className="ready-strip-next">编辑器工具仍关闭</span>
        <button
          type="button"
          className="btn btn-secondary btn-sm ready-strip-cta"
          disabled={props.busy}
          onClick={props.onEnable}
        >
          一键启用
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={props.onOpenSettings}
        >
          工具设置
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon ready-strip-dismiss"
          title="关闭提示"
          aria-label="关闭 Godot 工具提示"
          onClick={props.onDismiss}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
