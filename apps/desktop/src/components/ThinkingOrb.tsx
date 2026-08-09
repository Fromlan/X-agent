/**
 * ThinkingOrb — canvas 2D dotted thought-orb loading indicator, ported
 * from thinking-orbs (MIT © Jakub Antalik, https://github.com/Jakubantalik/thinking-orbs).
 * Ships four tuned states (working / listening / connecting / breathing)
 * at the 20px / 64px sizes. One rAF loop per instance on a shared
 * performance.now clock; pauses automatically while offscreen
 * (IntersectionObserver) or when the tab is hidden.
 *
 * State switches crossfade over TRANSITION_MS instead of hard-cutting:
 * the draw loop never rebuilds for a switch (display bookkeeping lives
 * in refs), and during a transition both patterns are painted each frame
 * at complementary global alphas — the old dissolves into the new.
 * Strictly monochrome: white dots on dark themes, black dots on light
 * themes, resolved from `body[data-theme]` (dark default) and followed
 * live via MutationObserver. Reduced-motion users get one static
 * representative frame.
 */

import { useEffect, useRef, useState } from "react";
import type { CanvasHTMLAttributes, CSSProperties } from "react";
import { MODE_DRAWS, resolvePreset } from "../lib/thinking-orbs/presets";
import type { OrbSize, OrbState } from "../lib/thinking-orbs/presets";
import {
  advanceTransition,
  nextTransition,
  transitionAlpha,
  type OrbTransition,
} from "../lib/thinking-orbs/transition";

/** Crossfade duration between state switches (ms). */
const TRANSITION_MS = 350;

/** Default per-state screen-reader labels (overridable via aria-label). */
const STATE_LABELS: Record<OrbState, string> = {
  working: "模型思考中",
  listening: "正在接收回复",
  connecting: "正在重试",
  breathing: "已就绪",
};

/**
 * Resolve whether the host page is on a light theme. The app writes
 * `${themeId}-${colorMode}` to body[data-theme]; anything not ending in
 * "-light" is treated as dark (the design default).
 */
function useBodyDark(): boolean {
  const [dark, setDark] = useState(() => {
    if (typeof document === "undefined") return true;
    return !document.body.dataset.theme?.endsWith("-light");
  });

  useEffect(() => {
    const update = () => {
      setDark(!document.body.dataset.theme?.endsWith("-light"));
    };
    const mo = new MutationObserver(update);
    mo.observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  return dark;
}

export function ThinkingOrb({
  state = "working",
  size = 20,
  speed = 1,
  paused = false,
  className,
  style,
  ...rest
}: {
  /** Which animated state to render. */
  state?: OrbState;
  size?: OrbSize;
  /** Multiplier on the preset's baked speed. */
  speed?: number;
  /** Freeze on the current frame. */
  paused?: boolean;
  className?: string;
  style?: CSSProperties;
} & CanvasHTMLAttributes<HTMLCanvasElement>) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const dark = useBodyDark();
  // Display bookkeeping lives in refs so a state switch never rebuilds
  // the draw loop: stateRef = latest prop, displayedRef = fully shown
  // state, transRef = in-flight crossfade (null when settled).
  const stateRef = useRef(state);
  const displayedRef = useRef(state);
  const transRef = useRef<OrbTransition | null>(null);

  // State prop change → start (or chain) a crossfade. Kept out of the
  // draw effect's deps so the rAF loop is never torn down for a switch.
  useEffect(() => {
    const prev = stateRef.current;
    stateRef.current = state;
    if (prev === state) return;
    transRef.current = transRef.current
      ? nextTransition(transRef.current.to, state)
      : nextTransition(displayedRef.current, state);
  }, [state]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // A rebuild (size/theme change) wipes any in-flight transition and
    // paints straight from the latest prop.
    displayedRef.current = stateRef.current;
    transRef.current = null;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Paint one state into the shared context at a mixing alpha. Each
    // mode carries its own baked speed, so scaling happens per state.
    const drawState = (s: OrbState, tSec: number, alpha: number) => {
      if (alpha < 0.02) return;
      const { mode, speed: baseSpeed, opts } = resolvePreset(s, size);
      ctx.globalAlpha = alpha;
      MODE_DRAWS[mode](ctx, size, tSec * baseSpeed * speed, dark, opts);
    };

    const frame = (tSec: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.globalAlpha = 1;
      const tr = transRef.current;
      if (tr) {
        // crossfade: outgoing pattern fades out, incoming fades in
        const a = transitionAlpha(tr, TRANSITION_MS);
        drawState(tr.from, tSec, 1 - a);
        drawState(tr.to, tSec, a);
      } else {
        drawState(displayedRef.current, tSec, 1);
      }
    };

    // reduced motion → one static frame of the target state, no transition
    if (reduced) {
      transRef.current = null;
      displayedRef.current = stateRef.current;
      frame(0.6);
      return;
    }

    let raf = 0;
    let running = false;
    let lastTs = 0;
    const loop = (ts: number) => {
      if (lastTs) {
        // transition clock advances by real frame deltas, so pauses
        // (offscreen / hidden tab) freeze it in place
        const tr = transRef.current;
        if (tr) {
          transRef.current = advanceTransition(tr, ts - lastTs, TRANSITION_MS);
          if (!transRef.current) displayedRef.current = tr.to;
        }
      }
      lastTs = ts;
      frame(ts / 1000);
      if (running) raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running || paused) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    // draw at least one frame even when paused/offscreen
    frame(performance.now() / 1000);

    // pause offscreen + on hidden tabs — free when not visible
    let visible = true;
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && document.visibilityState !== "hidden") start();
      else stop();
    });
    io.observe(canvas);
    const onVis = () => {
      if (document.visibilityState === "hidden") stop();
      else if (visible) start();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      stop();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [size, speed, paused, dark]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={STATE_LABELS[state]}
      className={className}
      style={{ width: size, height: size, display: "block", ...style }}
      {...rest}
    />
  );
}
