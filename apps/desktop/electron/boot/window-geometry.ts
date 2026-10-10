/** Keep native windows inside a display's DIP work area rather than enforcing a pixel-sized desktop floor. */
export type WorkArea = { x: number; y: number; width: number; height: number };

/** Clamp initial/minimum dimensions to the usable area; Electron already accounts for Windows DPI scaling. */
export function windowGeometry(area: WorkArea) {
  const width = Math.min(1280, area.width);
  const height = Math.min(840, area.height);
  return {
    width, height, minWidth: Math.min(900, area.width), minHeight: Math.min(600, area.height),
    x: area.x + Math.floor((area.width - width) / 2), y: area.y + Math.floor((area.height - height) / 2),
  };
}

/** Clamp a moved window to its current monitor, including smaller screens and negative desktop coordinates. */
export function fitWindow(bounds: WorkArea, area: WorkArea): WorkArea {
  const width = Math.min(bounds.width, area.width); const height = Math.min(bounds.height, area.height);
  return { width, height, x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)), y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)) };
}
