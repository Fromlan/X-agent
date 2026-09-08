/**
 * `useAppLayout` —— Issue #61 主题 F C-201 (2026-08-31).
 *
 * 把 App.tsx 的布局 state (sidebar / right panel 宽度 + viewport
 * tracking + column resize + 折叠) 收口到独立 hook, 暴露:
 *
 * - sidebarWidth / sidebarResizing / onSidebarResizePointerDown /
 *   onSidebarResizeDoubleClick / onToggleSidebarCollapsed
 * - rightPanelWidth / rightPanelResizing / onRightPanelResizePointerDown /
 *   onRightPanelResizeDoubleClick
 * - rightPanelOpen (read) / toggleRightPanel / ensureRightPanelOpen
 * - viewportWidth (read)
 * - layoutWidths (computed fit)
 * - narrowWindow (read)
 *
 * 持久化 (prefs 写) 由 setPrefs 注入, hook 不直接持 prefs。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClientPrefs } from "@shared/ipc";
import {
  RIGHT_PANEL_WIDTH_DEFAULT,
  RIGHT_PANEL_WIDTH_MAX,
  RIGHT_PANEL_WIDTH_MIN,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  fitColumnWidths,
  useColumnResize,
} from "./useColumnResize";
import { useNarrowWindow } from "./useNarrowWindow";

export type UseAppLayoutOpts = {
  prefs: ClientPrefs | null;
  setPrefs: (
    prefs:
      | ClientPrefs
      | null
      | ((prev: ClientPrefs | null) => ClientPrefs | null),
  ) => void;
};

export type UseAppLayoutResult = {
  /** CSS 变量, 给 main-row 用 */
  layoutWidths: { sidebar: number; right: number };
  narrowWindow: boolean;
  sidebarCollapsed: boolean;
  /** sidebar resize 状态 */
  sidebarWidth: number;
  sidebarResizing: boolean;
  onSidebarResizePointerDown: (e: React.PointerEvent) => void;
  onSidebarResizeDoubleClick: () => void;
  /** right panel resize 状态 */
  rightPanelWidth: number;
  rightPanelResizing: boolean;
  onRightPanelResizePointerDown: (e: React.PointerEvent) => void;
  onRightPanelResizeDoubleClick: () => void;
  /** 折叠 / 展开 / 持久化 */
  onToggleSidebarCollapsed: () => Promise<void> | void;
  /** right panel open / close */
  rightPanelOpen: boolean;
  toggleRightPanel: () => Promise<void>;
  ensureRightPanelOpen: () => Promise<void>;
};

export function useAppLayout(opts: UseAppLayoutOpts): UseAppLayoutResult {
  const { prefs, setPrefs } = opts;

  const narrowWindow = useNarrowWindow(960);
  const sidebarCollapsed = !narrowWindow && (prefs?.sidebarCollapsed ?? false);

  // Sidebar 宽度持久化
  const commitSidebarWidth = useCallback(
    async (sidebarWidth: number) => {
      setPrefs((prev) => (prev ? { ...prev, sidebarWidth } : prev));
      const next = await window.xAgent.prefs.set({ sidebarWidth });
      setPrefs(next);
    },
    [setPrefs],
  );
  const commitSidebarCollapsed = useCallback(
    async (sidebarCollapsed: boolean) => {
      setPrefs((prev) => (prev ? { ...prev, sidebarCollapsed } : prev));
      const next = await window.xAgent.prefs.set({ sidebarCollapsed });
      setPrefs(next);
    },
    [setPrefs],
  );

  const {
    width: sidebarWidth,
    dragging: sidebarResizing,
    onResizePointerDown: onSidebarResizePointerDown,
    onResizeDoubleClick: onSidebarResizeDoubleClick,
  } = useColumnResize({
    initialWidth: prefs?.sidebarWidth ?? SIDEBAR_WIDTH_DEFAULT,
    min: SIDEBAR_WIDTH_MIN,
    max: SIDEBAR_WIDTH_MAX,
    defaultWidth: SIDEBAR_WIDTH_DEFAULT,
    axis: "grow-right",
    onCommit: (w) => {
      void commitSidebarWidth(w);
    },
  });

  // Right panel 宽度持久化
  const commitRightPanelWidth = useCallback(
    async (rightPanelWidth: number) => {
      setPrefs((prev) => (prev ? { ...prev, rightPanelWidth } : prev));
      const next = await window.xAgent.prefs.set({ rightPanelWidth });
      setPrefs(next);
    },
    [setPrefs],
  );

  const {
    width: rightPanelWidth,
    dragging: rightPanelResizing,
    onResizePointerDown: onRightPanelResizePointerDown,
    onResizeDoubleClick: onRightPanelResizeDoubleClick,
  } = useColumnResize({
    initialWidth: prefs?.rightPanelWidth ?? RIGHT_PANEL_WIDTH_DEFAULT,
    min: RIGHT_PANEL_WIDTH_MIN,
    max: RIGHT_PANEL_WIDTH_MAX,
    defaultWidth: RIGHT_PANEL_WIDTH_DEFAULT,
    axis: "grow-left",
    onCommit: (w) => {
      void commitRightPanelWidth(w);
    },
  });

  // Viewport tracking
  const [viewportWidth, setViewportWidth] = useState(
    () => (typeof window !== "undefined" ? window.innerWidth : 1280),
  );
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const layoutWidths = useMemo(() => {
    if (sidebarCollapsed) {
      return fitColumnWidths({
        viewportWidth,
        sidebarWidth: 56,
        rightPanelWidth,
        rightPanelOpen: prefs?.rightPanelOpen ?? false,
        sidebarFloor: 56,
      });
    }
    return fitColumnWidths({
      viewportWidth,
      sidebarWidth,
      rightPanelWidth,
      rightPanelOpen: prefs?.rightPanelOpen ?? false,
    });
  }, [
    viewportWidth,
    sidebarWidth,
    rightPanelWidth,
    prefs?.rightPanelOpen,
    sidebarCollapsed,
  ]);

  const toggleRightPanel = useCallback(async () => {
    if (!prefs) return;
    const rightPanelOpen = !prefs.rightPanelOpen;
    setPrefs({ ...prefs, rightPanelOpen });
    const next = await window.xAgent.prefs.set({ rightPanelOpen });
    setPrefs(next);
  }, [prefs, setPrefs]);

  const ensureRightPanelOpen = useCallback(async () => {
    if (prefs?.rightPanelOpen) return;
    const next = await window.xAgent.prefs.set({ rightPanelOpen: true });
    setPrefs(next);
  }, [prefs, setPrefs]);

  const onToggleSidebarCollapsed = useCallback(
    () => commitSidebarCollapsed(!sidebarCollapsed),
    [commitSidebarCollapsed, sidebarCollapsed],
  );

  return {
    layoutWidths,
    narrowWindow,
    sidebarCollapsed,
    sidebarWidth,
    sidebarResizing,
    onSidebarResizePointerDown,
    onSidebarResizeDoubleClick,
    rightPanelWidth,
    rightPanelResizing,
    onRightPanelResizePointerDown,
    onRightPanelResizeDoubleClick,
    onToggleSidebarCollapsed,
    rightPanelOpen: prefs?.rightPanelOpen ?? false,
    toggleRightPanel,
    ensureRightPanelOpen,
  };
}
