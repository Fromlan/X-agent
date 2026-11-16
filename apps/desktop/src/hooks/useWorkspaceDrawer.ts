/** Give responsive workspace drawers a keyboard boundary and return focus when their modal state ends. */
import { useEffect, useRef } from "react";

const FOCUSABLE = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/** Ignore hidden or suspended dialogs so only the current modal owns keyboard focus. */
function isAvailable(element: HTMLElement): boolean {
  if (element.getClientRects().length === 0 || element.closest("[inert]") || element.matches(":disabled")
    || window.getComputedStyle(element).visibility === "hidden") return false;
  // Chromium can retain layout boxes for closed disclosure contents that cannot receive focus.
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.tagName === "DETAILS" && !ancestor.hasAttribute("open")) {
      const summary = ancestor.querySelector(":scope > summary");
      if (!summary?.contains(element)) return false;
    }
  }
  return true;
}

/** Settings and confirmation dialogs live outside the workspace drawer and take precedence over it. */
function hasExternalModal(panel: HTMLElement): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
    .some((dialog) => dialog !== panel && !panel.contains(dialog) && isAvailable(dialog));
}

/** Trap Tab/Escape only while modal; use a visible workspace entry if a menu trigger has already disappeared. */
export function useWorkspaceDrawer(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open || !ref.current) return;
    const panel = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    /** Exclude invisible menu entries and disabled background controls from the focus loop. */
    const controls = () => Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((element) => element.tabIndex >= 0 && isAvailable(element));
    const initial = panel.querySelector<HTMLElement>("[data-drawer-close]") ?? controls()[0] ?? panel;
    // A viewport resize can turn a dock into a drawer while settings remain on top.
    if (!panel.closest("[inert]") && !hasExternalModal(panel)) initial.focus();
    /** Keep keyboard navigation within the active drawer without affecting nonmodal docked panels. */
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || panel.closest("[inert]") || hasExternalModal(panel)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      } else if (event.key === "Tab") {
        const elements = controls();
        const first = elements[0] ?? panel;
        const last = elements.at(-1) ?? panel;
        const active = document.activeElement;
        if (!panel.contains(active) || (event.shiftKey ? active === first || active === panel : active === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      /** Check actual focus success because a formerly focused command may no longer accept focus. */
      const restoreFocus = (): boolean => {
        // The replacement modal may already be mounted before its focus effect runs.
        if (hasExternalModal(panel)) return true;
        // Becoming a dock changes modality without hiding the focused editor or control.
        const active = document.activeElement;
        if (panel.isConnected && isAvailable(panel) && active instanceof HTMLElement
          && panel.contains(active) && isAvailable(active)) return true;
        const fallback = document.querySelector<HTMLElement>(".workspace-menu > summary");
        for (const target of [previous, fallback]) {
          if (!target?.isConnected || target === document.body || !isAvailable(target)) continue;
          target.focus({ preventScroll: true });
          if (document.activeElement === target) return true;
        }
        return false;
      };
      if (restoreFocus()) return;
      // Retry a failed focus after this commit's inert changes, without replacing newly chosen focus.
      queueMicrotask(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && active !== document.body && !panel.contains(active) && isAvailable(active)) return;
        restoreFocus();
      });
    };
  }, [open]);
  return ref;
}
