/** Keep live context and editor status beside the plan, as in the approved workbench reference. */
import type { CSSProperties } from "react";
import { Box } from "lucide-react";
import type { GodotRpcStatusDto, SessionUsageSnapshot } from "@shared/ipc";
import { godotConnectionLabel, isProjectGodotConnected } from "../../lib/godot-connection";

interface Props {
  cwd: string | null;
  usage: SessionUsageSnapshot | null;
  isGodotProject: boolean;
  rpcStatus: GodotRpcStatusDto | null;
}

/** Format measured context only; an unloaded session must never show invented usage. */
function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${Number((tokens / 1000).toFixed(1))}k` : String(tokens);
}

/** Render a bounded meter while retaining an explicit unavailable state. */
export function WorkspaceSummary({ cwd, usage, isGodotProject, rpcStatus }: Props) {
  const context = usage?.context;
  const percent = context?.percent;
  const connected = isProjectGodotConnected(cwd, rpcStatus);
  return <div className="workspace-summary">
    <div className="workspace-context-heading"><span>上下文</span><span>{percent == null ? "—" : `${Math.round(percent)}%`}</span></div>
    <div className="workspace-context-meter" role="meter" aria-label="上下文用量" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent == null ? undefined : Math.round(percent)} aria-valuetext={percent == null ? "暂无统计" : undefined}>
      <span style={{ "--context-fill": `${Math.max(0, Math.min(100, percent ?? 0))}%` } as CSSProperties} />
    </div>
    <div className="workspace-context-tokens">{context?.tokens == null ? "暂无统计" : `${formatTokens(context.tokens)} / ${formatTokens(context.contextWindow)}`}</div>
    {isGodotProject && <div className="workspace-editor"><Box size={22} aria-hidden /><span>Godot 编辑器</span><span className={`workspace-editor-status${connected ? " is-connected" : ""}`}><i />{godotConnectionLabel(cwd, rpcStatus)}</span></div>}
  </div>;
}
