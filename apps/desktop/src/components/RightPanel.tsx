import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  BarChart3,
  Box,
  ClipboardList,
  FolderTree,
  Gamepad2,
  MoreHorizontal,
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

/** 主行固定 4 个常用 tab；其余收纳到「··」菜单。 */
const PRIMARY_TAB_IDS: ReadonlySet<RightPanelTab> = new Set([
  "context",
  "plan",
  "tools",
  "files",
]);

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

  const primaryTabs = TABS.filter((t) => PRIMARY_TAB_IDS.has(t.id));
  const overflowTabs = TABS.filter((t) => !PRIMARY_TAB_IDS.has(t.id));
  const activeOverflowTab = overflowTabs.find((t) => t.id === state.tab);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement | null>(null);

  // 点击外部或 Esc 关闭「··」菜单
  useEffect(() => {
    if (!overflowOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = overflowRef.current;
      if (!root) return;
      if (e.target instanceof Node && root.contains(e.target)) return;
      setOverflowOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOverflowOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [overflowOpen]);

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
        {primaryTabs.map((t) => {
          const Icon = t.icon;
          const isActive = state.tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              className={`rp-tab${isActive ? " active" : ""}`}
              onClick={() => setRightPanelTab(t.id)}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon size={13} aria-hidden strokeWidth={2} />
              <span className="rp-tab-label">{t.label}</span>
              {t.id === "plan" && planPath ? (
                <span className="rp-tab-dot" aria-hidden />
              ) : null}
            </button>
          );
        })}
        {overflowTabs.length > 0 && (
          <div className="rp-overflow" ref={overflowRef}>
            <button
              type="button"
              className={`rp-tab rp-overflow-trigger${activeOverflowTab ? " active" : ""}`}
              onClick={() => setOverflowOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={overflowOpen}
              aria-label="更多面板"
              title="更多面板"
            >
              <MoreHorizontal size={13} aria-hidden strokeWidth={2} />
              <span className="rp-tab-label">··</span>
              {activeOverflowTab ? (
                <span className="rp-tab-dot" aria-hidden />
              ) : null}
            </button>
            {overflowOpen && (
              <div className="rp-overflow-menu" role="menu">
                {overflowTabs.map((t) => {
                  const Icon = t.icon;
                  const isActive = state.tab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="menuitem"
                      className={`rp-overflow-item${isActive ? " active" : ""}`}
                      onClick={() => {
                        setRightPanelTab(t.id);
                        setOverflowOpen(false);
                      }}
                    >
                      <Icon
                        size={13}
                        aria-hidden
                        strokeWidth={2}
                      />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </nav>
      <div className="right-panel-body has-tabs">
        {state.tab === "game-stage" && <GameStageTab cwd={cwd} stage={gameStage} />}
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
