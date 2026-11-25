/** Retain a closing overlay just until its opacity transition ends, including interrupted exits. */
import { useLayoutEffect, useRef, useState } from "react";

/** The caller makes the retained surface inert as soon as its logical open state changes. */
export function useOverlayPresence<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T>(null);
  const [retained, setRetained] = useState(open);

  useLayoutEffect(() => {
    if (open) {
      setRetained(true);
      return;
    }
    const fade = ref.current?.getAnimations().find(
      (animation) => animation instanceof CSSTransition && animation.transitionProperty === "opacity",
    );
    if (!fade) {
      setRetained(false);
      return;
    }
    let current = true;
    /** A canceled transition also ends the exit when the motion preference changes mid-flight. */
    const finish = () => { if (current) setRetained(false); };
    void fade.finished.then(finish, finish);
    return () => { current = false; };
  }, [open]);

  return { ref, present: open || retained };
}
