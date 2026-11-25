/** Keep unsent text and attachments together while the user moves between conversations. */
import { useCallback, useMemo, useState, useSyncExternalStore, type SetStateAction } from "react";
import type { ImageContent } from "@shared/ipc";
import type { FileReference } from "../lib/file-attachment";

export interface Draft {
  input: string;
  attachments: ImageContent[];
  fileRefs: FileReference[];
}

/** Use one empty draft for resets so text and attachments always move together. */
function emptyDraft(): Draft {
  return { input: "", attachments: [], fileRefs: [] };
}

/** Treat a file-only or image-only draft as content worth preserving. */
function hasContent(draft: Draft): boolean {
  return Boolean(draft.input || draft.attachments.length || draft.fileRefs.length);
}

/** A pending file read or failed send keeps writing to its originating draft after navigation. */
function createDraft() {
  let snapshot = { ...emptyDraft(), recoverable: [] as Draft[] };
  let pendingFiles = 0;
  const listeners = new Set<() => void>();

  /** Publish a consistent draft snapshot to the active composer. */
  function publish(next: typeof snapshot) {
    snapshot = next;
    for (const notify of listeners) notify();
  }

  /** Publish one field update without rerendering a different conversation. */
  function update<K extends keyof Draft>(key: K, value: SetStateAction<Draft[K]>) {
    const next = typeof value === "function" ? value(snapshot[key]) : value;
    if (snapshot[key] === next) return;
    publish({ ...snapshot, [key]: next });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => { listeners.delete(notify); };
    },
    setInput: (value: SetStateAction<string>) => update("input", value),
    setAttachments: (value: SetStateAction<ImageContent[]>) => update("attachments", value),
    setFileRefs: (value: SetStateAction<FileReference[]>) => update("fileRefs", value),
    beginAttachmentRead() {
      pendingFiles++;
      return () => { pendingFiles--; };
    },
    needsSession() {
      return pendingFiles > 0 || hasContent(snapshot) || snapshot.recoverable.length > 0;
    },
    restoreDraft(saved: Draft) {
      if (!hasContent(saved)) return;
      if (hasContent(snapshot)) publish({ ...snapshot, recoverable: [...snapshot.recoverable, saved] });
      else publish({ ...saved, recoverable: snapshot.recoverable });
    },
    restoreNextDraft() {
      const [next, ...recoverable] = snapshot.recoverable;
      if (!next) return;
      const { input, attachments, fileRefs } = snapshot;
      if (hasContent(snapshot)) recoverable.push({ input, attachments, fileRefs });
      publish({ ...next, recoverable });
    },
  };
}

/** Drafts live only in this window and are released when their sessions are deleted. */
export function useSessionDraft(sessionId: string | null | undefined) {
  const [drafts] = useState(() => new Map<string, ReturnType<typeof createDraft>>());
  const draft = useMemo(() => {
    if (!sessionId) return createDraft();
    const existing = drafts.get(sessionId);
    if (existing) return existing;
    const next = createDraft();
    drafts.set(sessionId, next);
    return next;
  }, [drafts, sessionId]);
  const snapshot = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  const forgetDrafts = useCallback((ids: string[]) => {
    for (const id of ids) drafts.delete(id);
  }, [drafts]);
  return {
    input: snapshot.input, attachments: snapshot.attachments, fileRefs: snapshot.fileRefs,
    setInput: draft.setInput, setAttachments: draft.setAttachments, setFileRefs: draft.setFileRefs,
    restoreDraft: draft.restoreDraft, restoreNextDraft: draft.restoreNextDraft, forgetDrafts,
    recoverableCount: snapshot.recoverable.length,
    beginAttachmentRead: draft.beginAttachmentRead, needsSession: draft.needsSession,
  };
}
