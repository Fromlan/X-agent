/**
 * 把 ChatItem[] 派生出"按批次合并的渲染列表"。
 *
 * 目的：把同一段 assistant 流内连续出现的 tool 调用合并为一个
 * `toolBatch` 渲染节点，使 N 个 tool 在虚拟列表里只占 1 行，
 * 从根本上压缩"工具链路"占据的纵向空间。
 *
 * 数据层不变：本模块只对渲染前的 ChatItem[] 做派生，不修改
 * `applyAgentEvent` / `HistoryItem` 任何字段，因此：
 *   - 撤回 / 重新生成按 entryId 切片仍然精确
 *   - history_replace 直接替换数组时，本派生函数每次重算
 *   - 持久化的会话文件不感知批次
 */
import type { ChatItem } from "@shared/transcript";

/** 工具批次渲染节点 —— 多个连续 tool 合并后的视图容器。 */
export type ToolBatchRenderItem = {
  kind: "toolBatch";
  /** 稳定 id：取首项 toolCallId 前缀，便于 virtualizer getItemKey。 */
  id: string;
  /** 批次内的 tool 项（保留原 ChatItem 数据）。 */
  items: Extract<ChatItem, { kind: "tool" }>[];
};

/** 派生后的渲染条目：单条 ChatItem 或 toolBatch 视图节点。 */
export type RenderItem = ChatItem | ToolBatchRenderItem;

/**
 * 把连续 tool 项折叠为单个 toolBatch。规则：
 *
 * - 仅合并 `kind === "tool"` 的相邻项
 * - 遇到任一非 tool（user / assistant / system）即断开
 * - 单个孤立 tool 不包批次（保持 ToolCard 原视觉）
 * - 输入数组不会被修改；返回新数组
 *
 * @param items 已过滤可显示的 ChatItem 数组（与 ChatTranscript 当前 displayItems 同源）
 * @returns 派生后的渲染列表，单 tool 与非 tool 保持 ChatItem 形态，仅 ≥2 的连续 tool 合并为 toolBatch
 */
export function deriveToolBatches(items: ChatItem[]): RenderItem[] {
  const out: RenderItem[] = [];
  let run: Extract<ChatItem, { kind: "tool" }>[] = [];

  /**
   * 内部函数：把当前 run 封口输出。
   * 长度 ≥ 2 才输出 toolBatch；长度 1 退化为原 tool 行。
   */
  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      out.push(run[0]!);
    } else {
      out.push({
        kind: "toolBatch",
        // 取首项 id 作为批次稳定 id；history_replace 整体替换后本派生函数
        // 会重新计算，因此 id 与新内容一致即可。
        id: `batch-${run[0]!.id}`,
        items: run,
      });
    }
    run = [];
  };

  for (const item of items) {
    if (item.kind === "tool") {
      run.push(item);
    } else {
      flush();
      out.push(item);
    }
  }
  flush();

  return out;
}

/**
 * 批次内汇总：完成 / 失败 / 运行中 三类计数。
 * 用于批次标题的状态徽标展示。
 */
export function summarizeToolBatch(items: Extract<ChatItem, { kind: "tool" }>[]): {
  done: number;
  failed: number;
  running: number;
  allDone: boolean;
} {
  let done = 0;
  let failed = 0;
  let running = 0;
  for (const t of items) {
    if (!t.done) {
      running++;
    } else if (t.isError) {
      failed++;
    } else {
      done++;
    }
  }
  return { done, failed, running, allDone: items.length > 0 && running === 0 };
}

/**
 * 批次默认开合态的边缘转换函数（仅控制自动折叠，不自动展开）。
 *
 * - running → 返回 null（不强制展开，让用户主动点击查看进度）
 * - 刚刚全部完成（prevAllDone=false, allDone=true）→ 强制折叠一次
 *   （仅当用户先前手动展开过批次才产生可见效果）
 * - 已全部完成 → 返回 null（不再干扰用户后续手动开合）
 *
 * 调用方式与现有 `toolDetailsOpenForDoneTransition` 一致：
 * `useEffect([allDone], ...)` 内根据返回值同步 `<details>.open`。
 */
export function toolBatchOpenForDoneTransition(
  prevAllDone: boolean,
  allDone: boolean,
): boolean | null {
  if (!prevAllDone && allDone) return false;
  return null;
}
