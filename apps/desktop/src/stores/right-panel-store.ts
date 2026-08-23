export type RightPanelTab = "plan" | "tools" | "files" | "godot" | "context";

export type PanelState = {
  tab: RightPanelTab;
  selectedToolId: string | null;
  previewPath: string | null;
};

const DEFAULT_STATE: PanelState = {
  tab: "context",
  selectedToolId: null,
  previewPath: null,
};

type Listener = () => void;

let state: PanelState = { ...DEFAULT_STATE };
const listeners = new Set<Listener>();
let storeVersion = 0;

function emit(): void {
  storeVersion += 1;
  for (const l of listeners) l();
}

export function getPanelState(): PanelState {
  return state;
}

export function patchPanelState(patch: Partial<PanelState>): PanelState {
  state = { ...state, ...patch };
  emit();
  return state;
}

export function setRightPanelTab(tab: RightPanelTab): void {
  patchPanelState({ tab });
}

export function selectToolInPanel(
  toolId: string,
  previewPath?: string | null,
): void {
  patchPanelState({
    tab: "tools",
    selectedToolId: toolId,
    ...(previewPath !== undefined ? { previewPath } : {}),
  });
}

export function setPreviewPath(previewPath: string | null): void {
  patchPanelState({ previewPath });
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
