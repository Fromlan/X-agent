import { useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import {
  BarChart3,
  Box,
  ClipboardList,
  FolderTree,
  Gamepad2,
  PanelRightClose,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ChatItem } from "../stores/chat-store";
import type { GameStage } from "@shared/game-stage";
import type { SessionUsageSnapshot } from "@shared/ipc";
import {
  extractToolPath,
  getPanelState,
  getRightPanelStoreVersion,
  selectToolInPanel,
  setRightPanelTab,
  subscribeRightPanelStore,
  type RightPanelTab,
} from "../stores/right-panel-store";
import { ToolsTab } from "./right-panel/ToolsTab";
import { FilesTab } from "./right-panel/FilesTab";
import { GodotTab } from "./right-panel/GodotTab";
import { ContextTab } from "./right-panel/ContextTab";
import { PlanTab } from "./right-panel/PlanTab";
import { GameStageTab } from "./right-panel/GameStageTab";

const TABS: { id: RightPanelTab; label: string; icon: LucideIcon }[] = [
  { id: "context", label: "上下文", icon: BarChart3 },
  { id: "plan", label: "计划", icon: ClipboardList },
  { id: "tools", label: "工具", icon: Wrench },
  { id: "files", label: "文件", icon: FolderTree },
  { id: "game-stage", label: "阶段", icon: Gamepad2 },
  { id: "godot", label: "Godot", icon: Box },
];

interface Props {
  cwd: string | null;
  gameStage?: GameStage | null;
  items: ChatItem[];
  enabledTools: string[];
  usage: SessionUsageSnapshot | null;
  compacting: boolean;
  busy: boolean;
  sessionId: string | null;
  planPath?: string | null;
  autoCompactPercent?: number;
  onAutoCompactPercentChange?: (percent: number) => void;
  onClose: () => void;
  onAddPathToChat: (relPath: string) => void;
  onBuildPlan?: () => void;
  onPlanPathChange?: (path: string | null) => void;
  onResizePointerDown?: (e: ReactPointerEvent) => void;
  onResizeDoubleClick?: () => void;
  resizing?: boolean;
}

export function RightPanel({
  cwd,
  gameStage = null,
  items,
  enabledTools,
  usage,
  compacting,
  busy,
  sessionId,
  planPath = null,
  autoCompactPercent = 0,
  onAutoCompactPercentChange,
  onClose,
  onAddPathToChat,
  onBuildPlan,
  onPlanPathChange,
  onResizePointerDown,
  onResizeDoubleClick,
  resizing,
}: Props) {
  const version = useSyncExternalStore(
    subscribeRightPanelStore,
    getRightPanelStoreVersion,
    getRightPanelStoreVersion,
  );
  void version;
  const state = getPanelState();

  const onSelectTool = (toolId: string) => {
    const tool = items.find((i) => i.kind === "tool" && i.id === toolId);
    const path =
      tool && tool.kind === "tool" ? extractToolPath(tool.args) : null;
    selectToolInPanel(toolId, path);
  };

  return (
    <aside className="right-panel" aria-label="工具面板">
      {onResizePointerDown && (
        <div
          className={`column-resize-handle column-resize-handle--left${resizing ? " is-dragging" : ""}`}
          onPointerDown={onResizePointerDown}
          onDoubleClick={onResizeDoubleClick}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整工具面板宽度"
          title="拖动调整宽度 · 双击恢复默认"
        />
      )}
      <div className="right-panel-head">
        <h2 className="right-panel-title">工具面板</h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon"
          onClick={onClose}
          title="收起工具面板"
          aria-label="收起工具面板"
        >
          <PanelRightClose size={14} />
        </button>
      </div>
      <nav className="rp-tabs" aria-label="面板页签">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              className={`rp-tab${state.tab === t.id ? " active" : ""}`}
              onClick={() => setRightPanelTab(t.id)}
            >
              <Icon size={13} aria-hidden strokeWidth={2} />
              <span className="rp-tab-label">{t.label}</span>
              {t.id === "plan" && planPath ? (
                <span className="rp-tab-dot" aria-hidden />
              ) : null}
            </button>
          );
        })}
      </nav>
      <div className="right-panel-body has-tabs">
        {state.tab === "context" && (
          <ContextTab
            usage={usage}
            compacting={compacting}
            busy={busy}
            sessionId={sessionId}
            autoCompactPercent={autoCompactPercent}
            onAutoCompactPercentChange={onAutoCompactPercentChange}
          />
        )}
        {state.tab === "plan" && (
          <PlanTab
            planPath={planPath}
            busy={busy}
            onBuildPlan={() => onBuildPlan?.()}
            onPlanPathChange={onPlanPathChange}
          />
        )}
        {state.tab === "tools" && (
          <ToolsTab
            items={items}
            enabledTools={enabledTools}
            selectedToolId={state.selectedToolId}
            onSelectTool={onSelectTool}
          />
        )}
        {state.tab === "files" && (
          <FilesTab
            cwd={cwd}
            previewPath={state.previewPath}
            onAddPathToChat={onAddPathToChat}
          />
        )}
        {state.tab === "game-stage" && (
          <GameStageTab cwd={cwd} stage={gameStage} />
        )}
        {state.tab === "godot" && (
          <GodotTab active={state.tab === "godot"} items={items} />
        )}
      </div>
    </aside>
  );
}

/** Open panel on a tool from chat transcript. */
export function openToolInRightPanel(
  toolId: string,
  args: unknown,
  ensureOpen: () => void,
): void {
  ensureOpen();
  selectToolInPanel(toolId, extractToolPath(args));
}
