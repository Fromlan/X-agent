import { useEffect, useState, type RefObject } from "react";

/**
 * Track whether a scrollable element has scrolled past a threshold.
 * Used to mount `--shadow-soft` on the sticky TopBar only when content is
 * actually below the fold; this avoids the constant "压感" of a permanent
 * shadow on a bar that may have nothing to elevate against.
 */
export function useScrollElevated(
  scrollRef: RefObject<HTMLElement | null>,
  thresholdPx = 4,
): boolean {
  const [elevated, setElevated] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let raf = 0;
    const update = () => {
      setElevated(el.scrollTop > thresholdPx);
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };

    update();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollRef, thresholdPx]);

  return elevated;
}
