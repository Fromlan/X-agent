/**
 * DiffView —— 统一 diff 渲染组件。
 * 输入 shadow-git 产出的 unified diff 文本（可能被截断），按行分类渲染：
 * meta（diff --git / index / --- / +++ / Binary files）/ hunk（@@）/
 * add（+）/ del（-）/ ctx。供撤回预览弹窗与聊天流回合 diff 复用。
 */
import { memo, useMemo, useState } from "react";
import { FileCode2 } from "lucide-react";

export type DiffLineKind = "meta" | "hunk" | "add" | "del" | "ctx";

export type DiffLine = {
  kind: DiffLineKind;
  text: string;
};

/** 解析 unified diff 文本为分类行（含 +N / -M 统计与文件数）。 */
export function parseDiffLines(text: string): {
  lines: DiffLine[];
  fileCount: number;
  added: number;
  removed: number;
} {
  let fileCount = 0;
  let added = 0;
  let removed = 0;
  const lines: DiffLine[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    let kind: DiffLineKind = "ctx";
    if (line.startsWith("diff --git ") || line.startsWith("index ")) {
      kind = "meta";
      if (line.startsWith("diff --git ")) fileCount += 1;
    } else if (
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("Binary files ")
    ) {
      kind = "meta";
    } else if (line.startsWith("@@ ")) {
      kind = "hunk";
    } else if (line.startsWith("+")) {
      kind = "add";
      added += 1;
    } else if (line.startsWith("-")) {
      kind = "del";
      removed += 1;
    }
    lines.push({ kind, text: line });
  }
  return { lines, fileCount, added, removed };
}

interface DiffViewProps {
  text: string;
  /** 截断提示（文本超过 IPC 上限时显示）。 */
  truncated?: boolean;
  /** 默认展开（撤回预览默认展开；聊天流默认收起）。 */
  defaultOpen?: boolean;
  /** 展开态滚动区最大高度（px）。 */
  maxHeight?: number;
  /** 渲染行数上限（防超大 diff 卡 UI，超出部分不再渲染）。 */
  maxRenderLines?: number;
}

export const DiffView = memo(function DiffView(props: DiffViewProps) {
  const [open, setOpen] = useState(Boolean(props.defaultOpen));
  const { lines, fileCount, added, removed } = useMemo(
    () => parseDiffLines(props.text),
    [props.text],
  );
  const renderLines = useMemo(
    () => lines.slice(0, props.maxRenderLines ?? 4000),
    [lines, props.maxRenderLines],
  );
  const overflowed = lines.length > renderLines.length;

  return (
    <div className={`diff-view${open ? " is-open" : ""}`}>
      <div className="diff-view-head">
        <button
          type="button"
          className="diff-view-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <FileCode2 size={13} aria-hidden />
          <span>
            文件变更
            {fileCount > 0 ? ` · ${fileCount} 个文件` : ""}
            {(added > 0 || removed > 0) && (
              <span className="diff-view-stats">
                <span className="diff-stat-add"> +{added}</span>
                <span className="diff-stat-del"> -{removed}</span>
              </span>
            )}
          </span>
        </button>
        {(props.truncated || overflowed) && (
          <span className="diff-view-truncated">已截断</span>
        )}
      </div>
      {open && (
        <div
          className="diff-view-body"
          style={
            props.maxHeight != null
              ? { maxHeight: props.maxHeight }
              : undefined
          }
        >
          {renderLines.map((l, i) => (
            <div key={i} className={`diff-line is-${l.kind}`}>
              {l.text}
            </div>
          ))}
          {(props.truncated || overflowed) && (
            <div className="diff-view-tail">…diff 过大，仅显示开头部分</div>
          )}
        </div>
      )}
    </div>
  );
});
