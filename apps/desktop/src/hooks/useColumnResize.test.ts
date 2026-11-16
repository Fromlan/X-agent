/** Verify that viewport-clamped columns resize from their visible edge without changing untouched preferences. */
import { describe, expect, it } from "vitest";
import { getDraggedColumnWidth } from "./useColumnResize";
import { computeWorkspaceLayout } from "../lib/workspace-layout";

describe("column drag geometry", () => {
  it("responds immediately when a saved 507px panel is displayed at 363px", () => {
    const layout = computeWorkspaceLayout({ width: 979, sidebarWidth: 260, rightPanelWidth: 507,
      sidebarCollapsed: false, rightPanelOpen: true });
    const drag = { startWidth: 507, displayedWidth: layout.right, axis: "grow-left" as const, min: 360, max: 507 };
    expect(layout.right).toBe(363);
    expect(getDraggedColumnWidth({ ...drag, delta: 1 })).toBe(362);
    expect(getDraggedColumnWidth({ ...drag, delta: 2 })).toBe(361);
    expect(getDraggedColumnWidth({ ...drag, delta: 50 })).toBe(360);
  });

  it("preserves the preferred width when the pointer never moves or returns to its starting point", () => {
    expect(getDraggedColumnWidth({ startWidth: 507, displayedWidth: 363, delta: 0,
      axis: "grow-left", min: 360, max: 507 })).toBe(507);
  });

  it("supports a sidebar that grows to the right from its displayed edge", () => {
    expect(getDraggedColumnWidth({ startWidth: 260, displayedWidth: 180, delta: 20,
      axis: "grow-right", min: 160, max: 269 })).toBe(200);
  });

  it("keeps existing callers working when no displayed width is supplied", () => {
    expect(getDraggedColumnWidth({ startWidth: 507, delta: 20,
      axis: "grow-left", min: 360, max: 507 })).toBe(487);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1])("ignores unavailable displayed geometry %s", (displayedWidth) => {
    expect(getDraggedColumnWidth({ startWidth: 260, displayedWidth, delta: -20,
      axis: "grow-right", min: 160, max: 269 })).toBe(240);
  });

  it("still applies configured width limits after a visible-edge drag", () => {
    expect(getDraggedColumnWidth({ startWidth: 260, displayedWidth: 180, delta: 500,
      axis: "grow-right", min: 160, max: 269 })).toBe(269);
    expect(getDraggedColumnWidth({ startWidth: 260, displayedWidth: 180, delta: -500,
      axis: "grow-right", min: 160, max: 269 })).toBe(160);
  });
});
