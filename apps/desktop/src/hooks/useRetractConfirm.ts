import { useCallback, useState } from "react";
import type { RetractPreview } from "@shared/ipc";
import type { RetractConfirmMode } from "../components/RetractConfirmModal";
import { expandAtPathsInPrompt, collapseFileBlocksToAtPaths } from "../lib/expandAtPaths";

type ConfirmState = {
  mode: RetractConfirmMode;
  entryId: string;
  preview: RetractPreview;
  editText?: string;
};

type RetractDeps = {
  editDraft: string;
  setError: (error: string | null) => void;
  setInput: (text: string) => void;
  setEditingEntryId: (id: string | null) => void;
  setEditDraft: (text: string) => void;
  refreshSessions: () => Promise<void>;
};

export function useRetractConfirm(deps: RetractDeps) {
  const {
    editDraft,
    setError,
    setInput,
    setEditingEntryId,
    setEditDraft,
    refreshSessions,
  } = deps;

  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [retractBusy, setRetractBusy] = useState(false);

  const beginConfirm = useCallback(
    async (mode: RetractConfirmMode, entryId: string, editText?: string) => {
      setError(null);
      const preview = await window.xAgent.turn.previewRetract(entryId);
      if (!preview.ok) {
        setError(preview.error ?? "无法预览撤回");
        return;
      }
      setConfirmState({ mode, entryId, preview, editText });
    },
    [setError],
  );

  const runConfirmedRetract = useCallback(async () => {
    if (!confirmState) return;
    setRetractBusy(true);
    setError(null);
    try {
      const { mode, entryId, editText } = confirmState;
      let result;
      if (mode === "retract") {
        result = await window.xAgent.turn.retract(entryId, {
          undoFiles: true,
        });
      } else if (mode === "edit") {
        const expanded = await expandAtPathsInPrompt(editText ?? editDraft);
        result = await window.xAgent.turn.editAndResend(entryId, expanded, {
          undoFiles: true,
        });
      } else {
        result = await window.xAgent.turn.regenerate(entryId, {
          undoFiles: true,
        });
      }

      if (!result.ok) {
        setError(result.error ?? "操作失败");
        return;
      }

      if (mode === "retract") {
        const text =
          result.editorText?.trim() ||
          confirmState.preview.editorText?.trim() ||
          "";
        if (text) setInput(collapseFileBlocksToAtPaths(text));
      }

      const report = result.restoreReport;
      if (report?.warnings?.length) {
        setError(report.warnings.join(" "));
      }

      setConfirmState(null);
      setEditingEntryId(null);
      setEditDraft("");
      await refreshSessions();
    } finally {
      setRetractBusy(false);
    }
  }, [
    confirmState,
    editDraft,
    refreshSessions,
    setEditDraft,
    setEditingEntryId,
    setError,
    setInput,
  ]);

  const cancelConfirm = useCallback(() => {
    setConfirmState(null);
  }, []);

  return {
    confirmState,
    retractBusy,
    beginConfirm,
    runConfirmedRetract,
    cancelConfirm,
    setConfirmState,
  };
}
