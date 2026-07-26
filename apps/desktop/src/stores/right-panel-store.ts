export type RightPanelTab = "tools" | "files" | "godot";

export type SlotPanelState = {
  tab: RightPanelTab;
  selectedToolId: string | null;
  previewPath: string | null;
};

const DEFAULT_STATE: SlotPanelState = {
  tab: "tools",
  selectedToolId: null,
  previewPath: null,
};

type Listener = () => void;

const bySlot = new Map<string, SlotPanelState>();
const listeners = new Set<Listener>();
let storeVersion = 0;

function emit(): void {
  storeVersion += 1;
  for (const l of listeners) l();
}

function cloneDefault(): SlotPanelState {
  return { ...DEFAULT_STATE };
}

export function getSlotPanelState(slotId: string): SlotPanelState {
  return bySlot.get(slotId) ?? cloneDefault();
}

export function patchSlotPanelState(
  slotId: string,
  patch: Partial<SlotPanelState>,
): SlotPanelState {
  const prev = getSlotPanelState(slotId);
  const next = { ...prev, ...patch };
  bySlot.set(slotId, next);
  emit();
  return next;
}

export function setRightPanelTab(slotId: string, tab: RightPanelTab): void {
  patchSlotPanelState(slotId, { tab });
}

export function selectToolInPanel(
  slotId: string,
  toolId: string,
  previewPath?: string | null,
): void {
  patchSlotPanelState(slotId, {
    tab: "tools",
    selectedToolId: toolId,
    ...(previewPath !== undefined ? { previewPath } : {}),
  });
}

export function setPreviewPath(slotId: string, previewPath: string | null): void {
  patchSlotPanelState(slotId, { previewPath });
}

export function subscribeRightPanelStore(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRightPanelStoreVersion(): number {
  return storeVersion;
}

/** Parse project-relative path from common tool arg shapes. */
export function extractToolPath(args: unknown): string | null {
  if (args == null) return null;
  let obj: Record<string, unknown> | null = null;
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  } else if (typeof args === "object" && !Array.isArray(args)) {
    obj = args as Record<string, unknown>;
  }
  if (!obj) return null;
  for (const key of ["path", "file_path", "filePath", "target_file", "file"]) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim().replace(/\\/g, "/");
  }
  return null;
}
