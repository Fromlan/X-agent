import type { AgentStatus } from "@shared/ipc";
import type { ChatItem } from "../stores/chat-store";
import { MarkdownBody } from "./MarkdownBody";
import { ToolCard } from "./ToolCard";
import { Brain } from "lucide-react";
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
}

export function ChatTranscript(props: ChatTranscriptProps) {
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
            return (
              <div key={item.id} className="bubble bubble-user">
                <div className="bubble-label">你</div>
                <pre>{item.text}</pre>
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
            return (
              <div
                key={item.id}
                className={`bubble bubble-text${item.isError ? " is-error" : ""}`}
              >
                <div className="bubble-label">Agent</div>
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
