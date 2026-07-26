import { useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { PanelRightClose } from "lucide-react";
import type { ChatItem } from "../stores/chat-store";
import {
  extractToolPath,
  getRightPanelStoreVersion,
  getSlotPanelState,
  selectToolInPanel,
  setRightPanelTab,
  subscribeRightPanelStore,
  type RightPanelTab,
} from "../stores/right-panel-store";
import { ToolsTab } from "./right-panel/ToolsTab";
import { FilesTab } from "./right-panel/FilesTab";
import { GodotTab } from "./right-panel/GodotTab";

const TABS: { id: RightPanelTab; label: string }[] = [
  { id: "tools", label: "工具" },
  { id: "files", label: "文件" },
  { id: "godot", label: "Godot" },
];

interface Props {
  slotId: string;
  cwd: string | null;
  items: ChatItem[];
  onClose: () => void;
  onResizePointerDown?: (e: ReactPointerEvent) => void;
  onResizeDoubleClick?: () => void;
  resizing?: boolean;
}

export function RightPanel({
  slotId,
  cwd,
  items,
  onClose,
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
  const state = getSlotPanelState(slotId);

  const onSelectTool = (toolId: string) => {
    const tool = items.find((i) => i.kind === "tool" && i.id === toolId);
    const path =
      tool && tool.kind === "tool" ? extractToolPath(tool.args) : null;
    selectToolInPanel(slotId, toolId, path);
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
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`rp-tab${state.tab === t.id ? " active" : ""}`}
            onClick={() => setRightPanelTab(slotId, t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="right-panel-body has-tabs">
        {state.tab === "tools" && (
          <ToolsTab
            slotId={slotId}
            items={items}
            selectedToolId={state.selectedToolId}
            onSelectTool={onSelectTool}
          />
        )}
        {state.tab === "files" && (
          <FilesTab
            slotId={slotId}
            cwd={cwd}
            previewPath={state.previewPath}
          />
        )}
        {state.tab === "godot" && (
          <GodotTab slotId={slotId} active={state.tab === "godot"} items={items} />
        )}
      </div>
    </aside>
  );
}

/** Open panel on a tool from chat transcript. */
export function openToolInRightPanel(
  slotId: string,
  toolId: string,
  args: unknown,
  ensureOpen: () => void,
): void {
  ensureOpen();
  selectToolInPanel(slotId, toolId, extractToolPath(args));
}
