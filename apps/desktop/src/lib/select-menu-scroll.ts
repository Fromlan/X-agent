/**
 * Helpers for SelectMenu scroll / highlight behavior.
 *
 * A combined querySelector like
 *   `[data-highlighted="true"], [aria-selected="true"]`
 * returns the first match in *document order*, not selector priority. When the
 * selected option sits above a later highlight (typical after the user scrolls
 * the list), scrollIntoView jumps the panel back to the selected item — the
 * "bounce to top" glitch in the model picker.
 */

export type MenuHighlightReason = "open" | "keyboard" | "pointer";

/** Only keyboard / open should programmatically scroll; pointer hover must not. */
export function shouldScrollOptionIntoView(
  reason: MenuHighlightReason,
): boolean {
  return reason === "open" || reason === "keyboard";
}

/** Prefer the highlighted option; fall back to the selected option. */
export function resolveMenuScrollTarget<T>(panel: {
  querySelector(selectors: string): T | null;
}): T | null {
  return (
    panel.querySelector('[data-highlighted="true"]') ??
    panel.querySelector('[aria-selected="true"]')
  );
}

/** True when a scroll event originated inside the menu panel (not the page). */
export function isScrollInsidePanel<T>(
  panel: { contains(node: T): boolean } | null,
  target: T | null,
): boolean {
  if (!panel || target == null) return false;
  return panel.contains(target);
}
