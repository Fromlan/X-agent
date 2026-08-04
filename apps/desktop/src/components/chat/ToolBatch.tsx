/**
 * 工具批次容器 —— 把连续 N 个 tool 合并为一个可折叠 `<details>`。
 *
 * 视觉：
 *   - 标题行："工具调用 ×N" + 状态汇总（完成 X · 失败 Y · 运行中 K）
 *   - 折叠态 = 单行 pill
 *   - 展开态 = 竖排子 ToolCard，每张保持自己的开合记忆
 *
 * 数据层：本组件只消费已经派生的 toolBatch 节点，不接触 ChatItem[];
 *         ToolRow 仍由 bubbles.tsx 导出，复用现有 ToolCard + 执行计划 bar。
 */
import { memo, useEffect, useMemo, useRef } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Layers,
  Loader2,
  XCircle,
} from "lucide-react";
import type { AgentSessionMode } from "@shared/ipc";
import type { ChatItem } from "../../stores/chat-store";
import {
  summarizeToolBatch,
  toolBatchOpenForDoneTransition,
  type ToolBatchRenderItem,
} from "../../lib/chat-tool-batches";
import { ToolRow } from "./bubbles";

/** ToolBatch 透传属性 —— 与 ToolRowProps 对齐 + 批次整体开关。 */
export interface ToolBatchProps {
  /** 派生后的批次节点（包含 items + id）。 */
  item: ToolBatchRenderItem;
  /** 当前会话模式 —— 透传给 ToolRow 用于「执行计划」bar。 */
  sessionMode?: AgentSessionMode;
  /** 当前 plan 文件路径。 */
  planPath?: string | null;
  /** 是否流式中 —— 透传给 ToolRow 的执行计划按钮。 */
  streaming: boolean;
  /** 打开单个 tool 的右栏面板。 */
  onOpenToolInPanel?: (toolId: string, args: unknown) => void;
  /** 「执行计划」按钮回调。 */
  onBuildPlan?: () => void;
}

// 注意:不再保留 auto-expand。批次始终保持折叠,
// 等待用户主动点击标题展开;若用户先前手动展开过,
// `toolBatchOpenForDoneTransition` 会在刚 allDone 时一次性折叠。

/**
 * 工具批次容器组件。
 *
 * 默认开合通过 prevAllDoneRef + useEffect([allDone], ...) 在边缘触发，
 * 不与用户后续手动切换冲突；与 ToolCard 的 `toolDetailsOpenForDoneTransition`
 * 实现方式一致（imperatively sync `<details>.open`，规避 React 受控属性与
 * Chromium details 行为竞态）。
 */
export const ToolBatch = memo(function ToolBatch(props: ToolBatchProps) {
  const { item } = props;
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const prevAllDoneRef = useRef<boolean>(false);

  const summary = useMemo(() => summarizeToolBatch(item.items), [item.items]);

  // 边缘触发：刚 allDone → 折叠一次（仅当用户先前手动展开过才产生可见效果）；其余不动。
  useEffect(() => {
    const el = detailsRef.current;
    if (!el) return;
    const next = toolBatchOpenForDoneTransition(
      prevAllDoneRef.current,
      summary.allDone,
    );
    prevAllDoneRef.current = summary.allDone;
    if (next === null) return;
    el.open = next;
  }, [summary.allDone]);

  // 首挂时强制折叠 — 不再有"running → 展开"的自动行为,
  // 避免连续工具合并时先弹出再收纳的视觉跳动。
  useEffect(() => {
    const el = detailsRef.current;
    if (!el) return;
    el.open = false;
    prevAllDoneRef.current = summary.allDone;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 标题文案：基础 + 状态汇总（仅当存在非「完成」项时显示）。
  const titlePrefix = `工具调用 ×${item.items.length}`;
  const statusSuffix = useMemo(() => {
    const parts: string[] = [];
    if (summary.done > 0) parts.push(`完成 ${summary.done}`);
    if (summary.failed > 0) parts.push(`失败 ${summary.failed}`);
    if (summary.running > 0) parts.push(`运行中 ${summary.running}`);
    return parts.length > 0 ? parts.join(" · ") : "";
  }, [summary.done, summary.failed, summary.running]);

  // 状态徽标 = 当前最关键的态：失败 > 运行中 > 完成
  const overallState: "running" | "failed" | "done" = summary.running > 0
    ? "running"
    : summary.failed > 0
      ? "failed"
      : "done";
  const stateIcon = overallState === "running" ? (
    <Loader2 size={12} className="icon-spin" />
  ) : overallState === "failed" ? (
    <XCircle size={12} />
  ) : (
    <CheckCircle2 size={12} />
  );

  return (
    <details
      ref={detailsRef}
      className={[
        "bubble-tool-batch",
        summary.allDone ? "toolbatch-done" : "",
        overallState === "failed" ? "toolbatch-failed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-tool-batch-id={item.id}
    >
      <summary className="toolbatch-head">
        <span className="toolbatch-name">
          <ChevronRight size={12} className="toolbatch-chevron" aria-hidden />
          <Layers size={12} />
          <span className="toolbatch-title">{titlePrefix}</span>
          {statusSuffix && (
            <span className={`toolbatch-status is-${overallState}`}>
              {statusSuffix}
            </span>
          )}
        </span>
        <span className="toolbatch-state" title={statusSuffix || "完成"}>
          {stateIcon}
        </span>
      </summary>
      <div className="toolbatch-body">
        {item.items.map((tool) => (
          <ToolRow
            key={tool.id}
            item={tool as Extract<ChatItem, { kind: "tool" }>}
            sessionMode={props.sessionMode as AgentSessionMode | undefined}
            planPath={props.planPath ?? null}
            streaming={props.streaming}
            onOpenToolInPanel={props.onOpenToolInPanel}
            onBuildPlan={props.onBuildPlan}
          />
        ))}
      </div>
    </details>
  );
});
