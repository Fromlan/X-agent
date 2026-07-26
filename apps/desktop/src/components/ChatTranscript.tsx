import type { AgentStatus } from "@shared/ipc";
import type { ChatItem } from "../stores/chat-store";
import { MarkdownBody } from "./MarkdownBody";
import { ToolCard } from "./ToolCard";
import { Brain, Pencil, RotateCcw, Undo2 } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";

function ThinkingBlock({ thinking, done }: { thinking: string; done: boolean }) {
  const [open, setOpen] = useState(!done);

  useEffect(() => {
    if (!done) setOpen(true);
  }, [done]);

  return (
    <details
      className="bubble-thinking"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <Brain size={12} />
        思考过程
      </summary>
      <pre>{thinking}</pre>
    </details>
  );
}

function formatMaybeJson(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export interface ChatTranscriptProps {
  items: ChatItem[];
  showThinking: boolean;
  status?: AgentStatus;
  disabledEmpty?: boolean;
  bottomRef?: RefObject<HTMLDivElement | null>;
  onOpenToolInPanel?: (toolId: string, args: unknown) => void;
  editingEntryId?: string | null;
  editDraft?: string;
  onEditDraftChange?: (text: string) => void;
  onStartEdit?: (entryId: string, text: string) => void;
  onCancelEdit?: () => void;
  onConfirmEdit?: () => void;
  onRetract?: (entryId: string) => void;
  onRegenerate?: (userEntryId: string) => void;
}

export function ChatTranscript(props: ChatTranscriptProps) {
  const idle = props.status === "idle" || props.status === "error";
  const canAct = idle && !props.editingEntryId;

  return (
    <div className="chat-transcript">
      <div className="message-stream">
        {props.items.length === 0 && (
          <div className="empty-state">
            {props.disabledEmpty
              ? "请先打开一个项目文件夹，然后开始对话。"
              : "向 Agent 发送指令。运行中可继续发送（steer），或中止。"}
          </div>
        )}

        {props.items.map((item) => {
          if (item.kind === "user") {
            const entryId = item.entryId ?? item.id;
            const editing = props.editingEntryId === entryId;
            return (
              <div key={item.id} className="bubble bubble-user">
                {canAct && entryId && (
                  <div className="bubble-head">
                    <div className="bubble-actions">
                      <button
                        type="button"
                        className="btn btn-ghost bubble-action"
                        title="编辑并重发"
                        onClick={() => props.onStartEdit?.(entryId, item.text)}
                      >
                        <Pencil size={12} strokeWidth={2} />
                        <span>编辑</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost bubble-action"
                        title="撤回对话并还原文件"
                        onClick={() => props.onRetract?.(entryId)}
                      >
                        <Undo2 size={12} strokeWidth={2} />
                        <span>撤回</span>
                      </button>
                    </div>
                  </div>
                )}
                {editing ? (
                  <div className="bubble-edit">
                    <textarea
                      value={props.editDraft ?? item.text}
                      onChange={(e) => props.onEditDraftChange?.(e.target.value)}
                      rows={4}
                    />
                    <div className="bubble-edit-actions">
                      <button
                        type="button"
                        className="btn"
                        onClick={props.onCancelEdit}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        className="btn btn-cta"
                        onClick={props.onConfirmEdit}
                        disabled={!props.editDraft?.trim()}
                      >
                        重发
                      </button>
                    </div>
                  </div>
                ) : (
                  <pre>{item.text}</pre>
                )}
              </div>
            );
          }

          if (item.kind === "system") {
            return (
              <div
                key={item.id}
                className={`bubble bubble-system level-${item.level ?? "info"}`}
              >
                {item.text}
              </div>
            );
          }

          if (item.kind === "assistant") {
            const userEntryId = item.userEntryId;
            return (
              <div
                key={item.id}
                className={`bubble bubble-text${item.isError ? " is-error" : ""}`}
              >
                {canAct && item.done && userEntryId && (
                  <div className="bubble-head">
                    <div className="bubble-actions">
                      <button
                        type="button"
                        className="btn btn-ghost bubble-action"
                        title="重新生成"
                        onClick={() => props.onRegenerate?.(userEntryId)}
                      >
                        <RotateCcw size={12} strokeWidth={2} />
                        <span>重新生成</span>
                      </button>
                    </div>
                  </div>
                )}
                {props.showThinking && item.thinking && (
                  <ThinkingBlock thinking={item.thinking} done={item.done} />
                )}
                <MarkdownBody content={item.text} streaming={!item.done} />
              </div>
            );
          }

          return (
            <ToolCard
              key={item.id}
              toolCallId={item.id}
              toolName={item.toolName}
              args={formatMaybeJson(item.args)}
              result={formatMaybeJson(item.result)}
              isError={item.isError}
              done={item.done}
              onOpenInPanel={
                props.onOpenToolInPanel
                  ? () => props.onOpenToolInPanel?.(item.id, item.args)
                  : undefined
              }
            />
          );
        })}
        {props.bottomRef && <div ref={props.bottomRef} />}
      </div>
    </div>
  );
}