/** Budget real workspace columns before choosing a dock or modal drawer, keeping the conversation usable. */
export const WORKSPACE_CHAT_MIN = 560;
export const WORKSPACE_SIDEBAR_RAIL = 56;
export const WORKSPACE_PANEL_MIN = 320;

export interface WorkspaceLayoutInput {
  width: number;
  sidebarWidth: number;
  rightPanelWidth: number;
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
}

export interface WorkspaceLayout {
  sidebar: number;
  right: number;
  chat: number;
  sidebarDrawerWidth: number;
  sidebarCollapsed: boolean;
  sidebarAutoCollapsed: boolean;
  rightPanelMode: "closed" | "docked" | "drawer";
}

/** Clamp only the displayed geometry; caller-owned preferred widths remain unchanged for later expansion. */
export function computeWorkspaceLayout(input: WorkspaceLayoutInput): WorkspaceLayout {
  const width = Math.max(0, Number.isFinite(input.width) ? Math.floor(input.width) : 0);
  const preferredSidebar = Math.max(160, Number.isFinite(input.sidebarWidth) ? input.sidebarWidth : 260);
  const preferredRight = Math.max(WORKSPACE_PANEL_MIN, Number.isFinite(input.rightPanelWidth) ? input.rightPanelWidth : 360);
  const rightBudget = input.rightPanelOpen ? WORKSPACE_PANEL_MIN : 0;
  const sidebarAutoCollapsed = width - preferredSidebar - rightBudget < WORKSPACE_CHAT_MIN;
  const sidebarCollapsed = input.sidebarCollapsed || sidebarAutoCollapsed;
  const sidebar = Math.min(width, sidebarCollapsed ? WORKSPACE_SIDEBAR_RAIL : preferredSidebar);
  const room = Math.max(0, width - sidebar);
  const rightPanelMode = !input.rightPanelOpen ? "closed" : room >= WORKSPACE_CHAT_MIN + WORKSPACE_PANEL_MIN ? "docked" : "drawer";
  const right = rightPanelMode === "closed" ? 0 : rightPanelMode === "docked"
    ? Math.min(preferredRight, room - WORKSPACE_CHAT_MIN) : Math.min(preferredRight, Math.max(0, width - 32));
  return {
    sidebar, right, chat: room - (rightPanelMode === "docked" ? right : 0),
    sidebarDrawerWidth: Math.min(preferredSidebar, Math.max(0, width - 32)),
    sidebarCollapsed, sidebarAutoCollapsed, rightPanelMode,
  };
}
