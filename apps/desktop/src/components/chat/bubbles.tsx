/**
 * ChatTranscript 内 5 个 memo 子组件 + ClarifyPanel —— file-local 不导出,
 * 仅供 ChatTranscript.tsx 内部使用。抽出让 ChatTranscript 主文件聚焦状态/滚动/virtualizer。
 */
import { memo, useEffect, useMemo, useState } from "react";
import type { AgentSessionMode } from "@shared/ipc";
import type { ChatItem } from "../../stores/chat-store";
import { Brain, Check, Hammer, HelpCircle, Pencil, RotateCcw, Undo2 } from "lucide-react";
import { MarkdownBody } from "../MarkdownBody";
import { ToolCard } from "../ToolCard";
import { UserMessageBody } from "../UserMessageBody";
import {
  formatClarifyReply,
  parseClarifyBlocks,
  type ClarifyQuestion,
} from "../../lib/plan-clarify";
import { isWritePlanTool, planFileLabel } from "../../hooks/usePlanSession";

function formatMaybeJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export const ThinkingBlock = memo(function ThinkingBlock({
  thinking,
  done,
}: {
  thinking: string;
  done: boolean;
}) {
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
});

export type UserBubbleProps = {
  item: Extract<ChatItem, { kind: "user" }>;
  canAct: boolean;
  editing: boolean;
  editDraft?: string;
  onEditDraftChange?: (text: string) => void;
  onStartEdit?: (entryId: string, text: string) => void;
  onCancelEdit?: () => void;
  onConfirmEdit?: () => void;
  onRetract?: (entryId: string) => void;
};

export const UserBubble = memo(function UserBubble(props: UserBubbleProps) {
  const entryId = props.item.entryId ?? props.item.id;
  return (
    <div className="bubble bubble-user">
      {props.canAct && entryId && (
        <div className="bubble-head">
          <div className="bubble-actions">
            <button
              type="button"
              className="btn btn-ghost bubble-action"
              title="编辑并重发"
              onClick={() => props.onStartEdit?.(entryId, props.item.text)}
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
      {props.editing ? (
        <div className="bubble-edit">
          <textarea
            value={props.editDraft ?? props.item.text}
            onChange={(e) => props.onEditDraftChange?.(e.target.value)}
            rows={4}
          />
          <div className="bubble-edit-actions">
            <button type="button" className="btn" onClick={props.onCancelEdit}>
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
        <UserMessageBody text={props.item.text} />
      )}
    </div>
  );
});

export type AssistantBubbleProps = {
  item: Extract<ChatItem, { kind: "assistant" }>;
  showThinking: boolean;
  canAct: boolean;
  sessionMode?: AgentSessionMode;
  onRegenerate?: (userEntryId: string) => void;
  onClarifySelect?: (reply: string) => void;
};

export function ClarifyPanel(props: {
  questions: ClarifyQuestion[];
  canAct: boolean;
  onSubmit: (reply: string) => void;
}) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const answeredCount = props.questions.filter(
    (q) => Boolean(selected[q.question]),
  ).length;
  const allAnswered = answeredCount === props.questions.length;

  return (
    <div className="clarify-panel" role="group" aria-label="清澄选项">
      <div className="clarify-header">
        <HelpCircle size={14} aria-hidden />
        <span>请选择以下选项</span>
        <span
          className={
            "clarify-header-progress" +
            (allAnswered ? " is-complete" : "")
          }
        >
          已选 {answeredCount} / {props.questions.length}
        </span>
      </div>
      {props.questions.map((q, idx) => (
        <div key={q.question} className="clarify-question">
          <div className="clarify-q">
            <span className="clarify-q-num">{idx + 1}</span>
            <span className="clarify-q-text">{q.question}</span>
          </div>
          <div className="clarify-options" role="radiogroup" aria-label={q.question}>
            {q.options.map((opt) => {
              const isSelected = selected[q.question] === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  className={
                    "clarify-option" +
                    (isSelected ? " is-selected" : "")
                  }
                  disabled={!props.canAct}
                  aria-pressed={isSelected}
                  onClick={() =>
                    setSelected((prev) => ({ ...prev, [q.question]: opt }))
                  }
                >
                  <span className="clarify-option-check" aria-hidden>
                    <Check size={11} strokeWidth={3} />
                  </span>
                  <span className="clarify-option-label">{opt}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="clarify-actions">
        <span
          className={
            "clarify-actions-hint" + (allAnswered ? " is-complete" : "")
          }
        >
          {allAnswered
            ? "所有问题已选择完成"
            : "请为每个问题选择一项后再发送"}
        </span>
        <button
          type="button"
          className={
            "btn btn-sm clarify-submit" + (allAnswered ? " is-ready" : "")
          }
          disabled={!props.canAct || !allAnswered}
          title={
            allAnswered
              ? "发送全部所选答案"
              : "请为每个问题选择一项后再发送"
          }
          onClick={() => {
            const selections = props.questions.map((q) => ({
              question: q.question,
              option: selected[q.question],
            }));
            props.onSubmit(formatClarifyReply(selections));
          }}
        >
          发送所选
        </button>
      </div>
    </div>
  );
}
export const AssistantBubble = memo(function AssistantBubble(
  props: AssistantBubbleProps,
) {
  const userEntryId = props.item.userEntryId;
  const showThinkingBlock = Boolean(
    props.showThinking && props.item.thinking,
  );
  const clarifies =
    props.sessionMode === "plan" && props.item.done
      ? parseClarifyBlocks(props.item.text)
      : [];
  return (
    <div
      className={`bubble bubble-text${props.item.isError ? " is-error" : ""}`}
    >
      {props.canAct && props.item.done && userEntryId && (
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
      {showThinkingBlock && props.item.thinking && (
        <ThinkingBlock
          thinking={props.item.thinking}
          done={props.item.done}
        />
      )}
      <MarkdownBody
        content={props.item.text}
        streaming={!props.item.done}
        useMarkdown={props.item.done}
      />
      {clarifies.length > 0 && props.onClarifySelect && (
        <ClarifyPanel
          questions={clarifies}
          canAct={props.canAct}
          onSubmit={(reply) => props.onClarifySelect?.(reply)}
        />
      )}
    </div>
  );
});

export const SystemBubble = memo(function SystemBubble({
  item,
}: {
  item: Extract<ChatItem, { kind: "system" }>;
}) {
  return (
    <div className={`bubble bubble-system level-${item.level ?? "info"}`}>
      {item.text}
    </div>
  );
});

export type ToolRowProps = {
  item: Extract<ChatItem, { kind: "tool" }>;
  sessionMode?: AgentSessionMode;
  planPath?: string | null;
  streaming: boolean;
  onOpenToolInPanel?: (toolId: string, args: unknown) => void;
  onBuildPlan?: () => void;
};

export const ToolRow = memo(function ToolRow(props: ToolRowProps) {
  const { item } = props;
  const resultText = useMemo(() => formatMaybeJson(item.result), [item.result]);
  const openInPanel = useMemo(
    () =>
      props.onOpenToolInPanel
        ? () => props.onOpenToolInPanel?.(item.id, item.args)
        : undefined,
    [props.onOpenToolInPanel, item.id, item.args],
  );
  return (
    <div className="tool-with-actions">
      <ToolCard
        toolCallId={item.id}
        toolName={item.toolName}
        args={item.args}
        result={resultText}
        isError={item.isError}
        done={item.done}
        onOpenInPanel={openInPanel}
      />
      {isWritePlanTool(item.toolName) &&
        item.done &&
        !item.isError &&
        props.sessionMode === "plan" &&
        props.planPath &&
        props.onBuildPlan && (
          <div className="plan-execute-bar">
            <button
              type="button"
              className="btn btn-cta btn-sm"
              disabled={props.streaming}
              title={props.planPath}
              onClick={props.onBuildPlan}
            >
              <Hammer size={14} aria-hidden />
              执行计划
            </button>
            <span className="plan-execute-path" title={props.planPath}>
              {planFileLabel(props.planPath)}
            </span>
          </div>
        )}
    </div>
  );
});