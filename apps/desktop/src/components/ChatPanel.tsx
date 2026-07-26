import type { AgentStatus } from "@shared/ipc";
import type { ChatItem } from "../stores/chat-store";
import { ChatTranscript } from "./ChatTranscript";
import { Send, Square } from "lucide-react";
import { type KeyboardEvent, type RefObject } from "react";

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
  onOpenToolInPanel?: (toolId: string, args: unknown) => void;
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
      <ChatTranscript
        items={props.items}
        showThinking={props.showThinking}
        status={props.status}
        disabledEmpty={props.disabled}
        bottomRef={props.bottomRef}
        onOpenToolInPanel={props.onOpenToolInPanel}
      />

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
            className="btn btn-cta"
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
