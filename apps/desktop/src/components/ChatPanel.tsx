import { useEffect, useState, type KeyboardEvent, type RefObject } from "react";
import { Brain, Send, Square } from "lucide-react";
import type { AgentStatus } from "@shared/ipc";
import type { ChatItem } from "../stores/chat-store";
import { MarkdownBody } from "./MarkdownBody";
import { ToolCard } from "./ToolCard";

interface Props {
  items: ChatItem[];
  showThinking: boolean;
  status: AgentStatus;
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  onAbort: () => void;
  disabled: boolean;
  queuedSteering?: string[];
  bottomRef: RefObject<HTMLDivElement | null>;
}

function ThinkingBlock({ thinking, done }: { thinking: string; done: boolean }) {
  // Streaming: keep expanded. After done, leave user control (history starts collapsed).
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

export function ChatPanel(props: Props) {
  const streaming =
    props.status === "streaming" || props.status === "retrying";

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (props.input.trim()) props.onSend();
    }
  };

  return (
    <section className="chat-panel">
      <div className="message-stream">
        {props.items.length === 0 && (
          <div className="empty-state">
            {props.disabled
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
              toolName={item.toolName}
              args={formatMaybeJson(item.args)}
              result={formatMaybeJson(item.result)}
              isError={item.isError}
              done={item.done}
            />
          );
        })}
        <div ref={props.bottomRef} />
      </div>

      {props.queuedSteering && props.queuedSteering.length > 0 && (
        <div className="queue-banner">
          已排队 steer：{props.queuedSteering.map((t) => `"${t.slice(0, 40)}"`).join(" · ")}
        </div>
      )}

      <div className="composer">
        <textarea
          value={props.input}
          onChange={(e) => props.setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            props.disabled
              ? "请先打开项目…"
              : streaming
                ? "运行中：Enter 发送 steer，Shift+Enter 换行"
                : "输入消息，Enter 发送，Shift+Enter 换行"
          }
          disabled={props.disabled}
          rows={3}
        />
        <div className="composer-actions">
          {streaming && (
            <button type="button" className="btn btn-danger" onClick={props.onAbort}>
              <Square size={14} />
              中止
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={props.onSend}
            disabled={props.disabled || !props.input.trim()}
          >
            <Send size={14} />
            {streaming ? "Steer" : "发送"}
          </button>
        </div>
      </div>
    </section>
  );
}
