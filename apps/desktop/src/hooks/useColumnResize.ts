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
export const SIDEBAR_WIDTH_MIN = 180;
export const SIDEBAR_WIDTH_MAX = 480;

export const RIGHT_PANEL_WIDTH_DEFAULT = 360;
export const RIGHT_PANEL_WIDTH_MIN = 280;
export const RIGHT_PANEL_WIDTH_MAX = 640;
