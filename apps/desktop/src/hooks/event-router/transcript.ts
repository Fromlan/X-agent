/**
 * Event router 子模块: transcript 应用 —— Issue #61 主题 F C-207.
 *
 * 抽出 `history_replace` (清理 editingEntryId) + 通用 applyAgentEvent
 * (chat-store reducer) 调用。
 */
import type { UiAgentEvent } from "@shared/ipc";
import type { ChatItem } from "../../stores/chat-store";
import { applyAgentEvent } from "../../stores/chat-store";

export type TranscriptDeps = {
  setItems: (items: ChatItem[] | ((prev: ChatItem[]) => ChatItem[])) => void;
  setEditingEntryId: (
    id: string | null | ((prev: string | null) => string | null),
  ) => void;
};

/**
 * 把 event 应用到 chat-store. 注意: 即使本子模块 "消费" 了 event
 * (e.g. history_replace 内部的 setEditingEntryId), 也仍然走
 * applyAgentEvent, 保持 chat transcript 与 router 一致。
 *
 * 返回 `true` 表示本子模块处理了 event (作为副作用 hint)。
 */
export function applyTranscriptEvent(
  event: UiAgentEvent,
  deps: TranscriptDeps,
): boolean {
  if (event.type === "history_replace") {
    // Do not clear queuedSteering here — queue_update owns that snapshot.
    deps.setEditingEntryId((id) => {
      if (!id) return null;
      const stillThere = event.items.some(
        (it) => it.kind === "user" && (it.entryId === id || it.id === id),
      );
      return stillThere ? id : null;
    });
  }
  deps.setItems((prev) => applyAgentEvent(prev, event));
  return true;
}
