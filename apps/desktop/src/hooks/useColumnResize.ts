import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

export type ColumnResizeAxis = "grow-right" | "grow-left";

export function clampWidth(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function useColumnResize(options: {
  initialWidth: number;
  min: number;
  max: number;
  defaultWidth: number;
  /** grow-right: drag right increases width (left sidebar). grow-left: drag left increases width (right panel). */
  axis: ColumnResizeAxis;
  onCommit: (width: number) => void;
}) {
  const { min, max, defaultWidth, axis, onCommit } = options;
  const [width, setWidth] = useState(() =>
    clampWidth(options.initialWidth, min, max),
  );
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const widthRef = useRef(width);
  const onCommitRef = useRef(onCommit);

  widthRef.current = width;
  onCommitRef.current = onCommit;

  useEffect(() => {
    if (dragging) return;
    setWidth(clampWidth(options.initialWidth, min, max));
  }, [options.initialWidth, dragging, min, max]);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const delta = e.clientX - d.startX;
      const next =
        axis === "grow-right" ? d.startW + delta : d.startW - delta;
      setWidth(clampWidth(next, min, max));
    };

    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
      document.body.classList.remove("is-resizing-column");
      onCommitRef.current(widthRef.current);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, axis, min, max]);

  const onResizePointerDown = useCallback((e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragRef.current = { startX: e.clientX, startW: widthRef.current };
    setDragging(true);
    document.body.classList.add("is-resizing-column");
  }, []);

  const onResizeDoubleClick = useCallback(() => {
    setWidth(defaultWidth);
    onCommitRef.current(defaultWidth);
  }, [defaultWidth]);

  return {
    width,
    dragging,
    onResizePointerDown,
    onResizeDoubleClick,
  };
}

export const SIDEBAR_WIDTH_DEFAULT = 260;
export const SIDEBAR_WIDTH_MIN = 160;
export const SIDEBAR_WIDTH_MAX = 269;

// D9: 与 prefs 默认（rightPanelWidth: 360）及 DESIGN.md「RightPanel ~360px」对齐。
export const RIGHT_PANEL_WIDTH_DEFAULT = 360;
export const RIGHT_PANEL_WIDTH_MIN = 360;
export const RIGHT_PANEL_WIDTH_MAX = 507;

/** Keep chat column usable when the window shrinks. */
export const CHAT_COLUMN_MIN = 300;

export function fitColumnWidths(options: {
  viewportWidth: number;
  sidebarWidth: number;
  rightPanelWidth: number;
  rightPanelOpen: boolean;
  chatMin?: number;
  sidebarFloor?: number;
  rightFloor?: number;
}): { sidebar: number; right: number } {
  const chatMin = options.chatMin ?? CHAT_COLUMN_MIN;
  const sidebarFloor = options.sidebarFloor ?? 140;
  const rightFloor = options.rightFloor ?? 200;
  let sidebar = options.sidebarWidth;
  let right = options.rightPanelOpen ? options.rightPanelWidth : 0;
  const budget = Math.max(options.viewportWidth, chatMin + sidebarFloor);

  const overflow = () => sidebar + right + chatMin - budget;

  let extra = overflow();
  if (extra <= 0) return { sidebar, right };

  if (right > 0) {
    const shrink = Math.min(extra, Math.max(0, right - rightFloor));
    right -= shrink;
    extra = overflow();
  }
  if (extra > 0) {
    const shrink = Math.min(extra, Math.max(0, sidebar - sidebarFloor));
    sidebar -= shrink;
    extra = overflow();
  }
  if (extra > 0 && right > 0) {
    right = Math.max(rightFloor, right - extra);
    extra = overflow();
  }
  if (extra > 0) {
    sidebar = Math.max(sidebarFloor, budget - chatMin - right);
  }
  return { sidebar, right };
}
