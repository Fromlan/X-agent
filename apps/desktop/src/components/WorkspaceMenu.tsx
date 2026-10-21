/** Retain secondary workspace utilities without putting a second toolbar in the reference title bar. */
import { MoreHorizontal, Moon, PanelRight, Sun, Download, PanelLeftClose } from "lucide-react";
import type { AppUpdateStatus, ColorMode } from "@shared/ipc";

interface Props {
  theme: ColorMode;
  rightPanelOpen: boolean;
  onToggleTheme: () => void;
  onToggleRightPanel: () => void;
  onToggleSidebar: () => void;
  updateStatus?: AppUpdateStatus | null;
  updateBusy?: boolean;
  onUpdate: () => void;
}

/** Native disclosure supplies keyboard activation; each command dismisses the utility menu. */
export function WorkspaceMenu(props: Props) {
  return (
    <details className="workspace-menu" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false;
    }} onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.open = false; }}>
      <summary aria-label="工作区选项" title="工作区选项"><MoreHorizontal size={18} aria-hidden /></summary>
      <div className="workspace-menu-body" onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) event.currentTarget.closest("details")!.open = false;
      }}>
        <button type="button" title={props.rightPanelOpen ? "收起工具面板" : "打开工具面板"} aria-label="切换工具面板" aria-pressed={props.rightPanelOpen} onClick={props.onToggleRightPanel}><PanelRight size={15} />{props.rightPanelOpen ? "收起工具面板" : "打开工具面板"}</button>
        <button type="button" aria-label="切换主题" onClick={props.onToggleTheme}>{props.theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}{props.theme === "dark" ? "切换浅色" : "切换深色"}</button>
        <button type="button" aria-label="切换会话栏" onClick={props.onToggleSidebar}><PanelLeftClose size={15} />收起或展开会话栏</button>
        {props.updateStatus?.available && <button type="button" aria-label="有可用更新" disabled={props.updateBusy || props.updateStatus.downloading} onClick={props.onUpdate}><Download size={15} />{props.updateStatus.downloaded ? "安装更新" : props.updateStatus.downloading ? "下载中…" : `更新 ${props.updateStatus.version ?? ""}`}</button>}
      </div>
    </details>
  );
}
