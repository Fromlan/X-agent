/** Test physical 1366x768 screens at common Windows scales using Electron's DIP work-area contract. */
import { expect, it } from "vitest";
import { fitWindow, windowGeometry } from "./window-geometry";
it.each([1, 1.25, 1.5])("fits a small display at scale %s", (scale) => {
  const area = { x: 0, y: 0, width: Math.floor(1366 / scale), height: Math.floor(728 / scale) };
  const geometry = windowGeometry(area);
  expect(geometry.width).toBeLessThanOrEqual(area.width); expect(geometry.height).toBeLessThanOrEqual(area.height);
  expect(geometry.minWidth).toBeLessThanOrEqual(geometry.width); expect(geometry.minHeight).toBeLessThanOrEqual(geometry.height);
});
it("fits a moved window to a smaller monitor with negative coordinates", () => {
  expect(fitWindow({ x: 100, y: 100, width: 1280, height: 840 }, { x: -900, y: 0, width: 900, height: 500 })).toEqual({ x: -900, y: 0, width: 900, height: 500 });
});
