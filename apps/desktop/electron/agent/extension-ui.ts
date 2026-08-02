/**
 * Minimal Pi ExtensionUIContext for Electron — routes notify to the chat
 * notice channel. Dialogs / TUI widgets stay no-op (desktop has its own UI).
 */
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

export type ExtensionNotifyLevel = "info" | "warning" | "error";

/** Build a UI context whose `notify` calls `onNotify`. */
export function createDesktopExtensionUi(
  onNotify: (message: string, type: ExtensionNotifyLevel) => void,
): ExtensionUIContext {
  return {
    select: async () => undefined,
    confirm: async () => false,
    input: async () => undefined,
    notify: (message, type = "info") => {
      const text = String(message ?? "").trim();
      if (!text) return;
      onNotify(text, type);
    },
    onTerminalInput: () => () => {},
    setStatus: () => {},
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    custom: async () => undefined as never,
    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => "",
    editor: async () => undefined,
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    get theme() {
      // Theme is unused by notify-only commands; satisfy the type.
      return {} as ExtensionUIContext["theme"];
    },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: "UI not available" }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  };
}

export function mapExtensionNotifyLevel(
  type: ExtensionNotifyLevel,
): "info" | "warn" | "error" {
  if (type === "warning") return "warn";
  if (type === "error") return "error";
  return "info";
}
