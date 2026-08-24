import { useEffect, useState } from "react";

/**
 * Returns true when the viewport width is at or below `thresholdPx`.
 * Used to gate auto-expand behavior (e.g. sidebar collapse disables itself
 * on narrow windows so users still have a session entry point).
 *
 * Updates on `resize` (debounced via rAF) and on initial mount.
 */
export function useNarrowWindow(thresholdPx = 960): boolean {
  const [narrow, setNarrow] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth <= thresholdPx;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    let raf = 0;
    const update = () => {
      raf = 0;
      setNarrow(window.innerWidth <= thresholdPx);
    };
    const onResize = () => {
      if (raf) return;
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [thresholdPx]);

  return narrow;
}
