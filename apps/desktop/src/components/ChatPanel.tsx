import type { AgentStatus } from "@shared/ipc";
import type { ChatItem } from "../stores/chat-store";
import { ChatTranscript } from "./ChatTranscript";
import { GitBranchPlus, Send, Square } from "lucide-react";
import { type KeyboardEvent, type RefObject } from "react";

interface Props {
  title?: string;
  roleHint?: string;
  items: ChatItem[];
  showThinking: boolean;
  status: AgentStatus;
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  onAbort: () => void;
  onStartPair?: () => void;
  pairActive?: boolean;
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
        title={props.title}
        roleHint={props.roleHint}
        items={props.items}
        showThinking={props.showThinking}
        status={props.status}
        focused
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
          {props.onStartPair && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={props.onStartPair}
              disabled={
                props.disabled ||
                !props.input.trim() ||
                props.pairActive ||
                streaming
              }
              title="用当前输入启动 worker+reviewer 并行编排"
            >
              <GitBranchPlus size={14} />
              并行实现+审阅
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

/** Dual-pane layout: worker | reviewer transcripts + shared composer. */
interface DualProps {
  workerTitle: string;
  reviewerTitle: string;
  workerItems: ChatItem[];
  reviewerItems: ChatItem[];
  workerStatus: AgentStatus;
  reviewerStatus: AgentStatus;
  activeRole: "worker" | "reviewer";
  showThinking: boolean;
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  onAbort: () => void;
  onStartPair?: () => void;
  pairActive?: boolean;
  disabled: boolean;
  queuedSteering?: string[];
  onFocusWorker: () => void;
  onFocusReviewer: () => void;
  workerBottomRef: RefObject<HTMLDivElement | null>;
  reviewerBottomRef: RefObject<HTMLDivElement | null>;
  onOpenToolInPanelWorker?: (toolId: string, args: unknown) => void;
  onOpenToolInPanelReviewer?: (toolId: string, args: unknown) => void;
}

export function DualChatPanel(props: DualProps) {
  const activeStatus =
    props.activeRole === "worker" ? props.workerStatus : props.reviewerStatus;
  const streaming =
    activeStatus === "streaming" || activeStatus === "retrying";

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (props.input.trim()) props.onSend();
    }
  };

  return (
    <section className="chat-panel chat-panel-dual">
      <div className="chat-dual-panes">
        <ChatTranscript
          title={props.workerTitle}
          roleHint="工"
          items={props.workerItems}
          showThinking={props.showThinking}
          status={props.workerStatus}
          focused={props.activeRole === "worker"}
          disabledEmpty={props.disabled}
          onFocus={props.onFocusWorker}
          bottomRef={props.workerBottomRef}
          onOpenToolInPanel={props.onOpenToolInPanelWorker}
        />
        <ChatTranscript
          title={props.reviewerTitle}
          roleHint="审"
          items={props.reviewerItems}
          showThinking={props.showThinking}
          status={props.reviewerStatus}
          focused={props.activeRole === "reviewer"}
          disabledEmpty={props.disabled}
          onFocus={props.onFocusReviewer}
          bottomRef={props.reviewerBottomRef}
          onOpenToolInPanel={props.onOpenToolInPanelReviewer}
        />
      </div>

      {props.queuedSteering && props.queuedSteering.length > 0 && (
        <div className="queue-banner">
          已排队 steer：{props.queuedSteering.map((t) => `"${t.slice(0, 40)}"`).join(" · ")}
        </div>
      )}

      <div className="composer">
        <div className="composer-target-hint">
          发送到：{props.activeRole === "worker" ? props.workerTitle : props.reviewerTitle}
        </div>
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
          {props.onStartPair && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={props.onStartPair}
              disabled={
                props.disabled ||
                !props.input.trim() ||
                props.pairActive ||
                streaming
              }
              title="用当前输入启动 worker+reviewer 并行编排"
            >
              <GitBranchPlus size={14} />
              并行实现+审阅
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
