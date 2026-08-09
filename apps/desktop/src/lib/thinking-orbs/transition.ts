/**
 * Crossfade transition state machine for the orb engine. Pure functions
 * so the component loop stays thin and the math is unit-testable.
 * Progress is driven by rAF frame deltas (not wall clock), so pausing
 * freezes the transition and resuming finishes it in place.
 */

import type { OrbState } from "./presets";

/** In-flight crossfade between two orb states. */
export interface OrbTransition {
  from: OrbState;
  to: OrbState;
  /** Accumulated frame-delta time in ms. */
  elapsedMs: number;
}

/** Cubic ease-out — fast start, gentle settle. */
export function easeOutCubic(p: number): number {
  return 1 - (1 - p) ** 3;
}

/** Start a transition when the displayed state differs from the prop. */
export function nextTransition(
  displayed: OrbState,
  next: OrbState,
): OrbTransition | null {
  return displayed === next ? null : { from: displayed, to: next, elapsedMs: 0 };
}

/** Advance the transition clock by a frame delta; null once complete. */
export function advanceTransition(
  tr: OrbTransition,
  dtMs: number,
  durationMs: number,
): OrbTransition | null {
  const elapsedMs = tr.elapsedMs + dtMs;
  if (elapsedMs >= durationMs) return null;
  return { from: tr.from, to: tr.to, elapsedMs };
}

/** Mixing alpha of the INCOMING state in [0, 1]; outgoing is 1 - alpha. */
export function transitionAlpha(tr: OrbTransition, durationMs: number): number {
  return easeOutCubic(Math.min(1, tr.elapsedMs / durationMs));
}
