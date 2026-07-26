import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy, Loader2, XCircle } from "lucide-react";
import type { ChatItem } from "../../stores/chat-store";
import {
  extractToolPath,
  setPreviewPath,
} from "../../stores/right-panel-store";

function formatMaybeJson(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

interface Props {
  slotId: string;
  items: ChatItem[];
  selectedToolId: string | null;
  onSelectTool: (toolId: string) => void;
}

export function ToolsTab({
  slotId,
  items,
  selectedToolId,
  onSelectTool,
}: Props) {
  const tools = useMemo(
    () => items.filter((i): i is Extract<ChatItem, { kind: "tool" }> => i.kind === "tool"),
    [items],
  );

  const selected = tools.find((t) => t.id === selectedToolId) ?? null;
  const [detailArgs, setDetailArgs] = useState("");
  const [detailResult, setDetailResult] = useState("");
  const [detailTruncated, setDetailTruncated] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!selected) {
      setDetailArgs("");
      setDetailResult("");
      setDetailTruncated(false);
      setDetailError(null);
      return;
    }

    setDetailArgs(formatMaybeJson(selected.args));
    setDetailResult(formatMaybeJson(selected.result));
    setDetailTruncated(false);
    setDetailError(null);

    void window.xAgent.getToolDetail(selected.id).then((detail) => {
      if (cancelled || !detail) return;
      setDetailArgs(formatMaybeJson(detail.args));
      setDetailResult(formatMaybeJson(detail.result));
      setDetailTruncated(Boolean(detail.truncated));
      const path = extractToolPath(detail.args);
      if (path) setPreviewPath(slotId, path);
    });

    return () => {
      cancelled = true;
    };
  }, [selected, slotId]);

  const copyAll = async () => {
    const text = [
      selected ? `# ${selected.toolName}` : "",
      detailArgs ? `## args\n${detailArgs}` : "",
      detailResult ? `## result\n${detailResult}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setDetailError("复制失败");
    }
  };

  if (tools.length === 0) {
    return (
      <div className="rp-empty">
        当前槽位还没有工具调用。Agent 运行后会出现在这里。
      </div>
    );
  }

  return (
    <div className="rp-tools">
      <ul className="rp-tool-list">
        {tools.map((t) => {
          const active = t.id === selectedToolId;
          return (
            <li key={t.id}>
              <button
                type="button"
                className={`rp-tool-item${active ? " active" : ""}${t.isError ? " is-error" : ""}`}
                onClick={() => onSelectTool(t.id)}
              >
                <span className="rp-tool-item-name">{t.toolName}</span>
                <span className="rp-tool-item-state">
                  {!t.done ? (
                    <Loader2 size={12} className="icon-spin" />
                  ) : t.isError ? (
                    <XCircle size={12} />
                  ) : (
                    <CheckCircle2 size={12} />
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="rp-tool-detail">
        {selected ? (
          <>
            <div className="rp-tool-detail-head">
              <strong>{selected.toolName}</strong>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void copyAll()}
              >
                <Copy size={12} />
                {copied ? "已复制" : "复制"}
              </button>
            </div>
            {detailTruncated && (
              <div className="rp-banner-soft">内容已达缓存上限，可能仍有截断。</div>
            )}
            {detailError && <div className="rp-banner-soft">{detailError}</div>}
            {detailArgs && (
              <div className="rp-section">
                <div className="rp-section-label">参数</div>
                <pre>{detailArgs}</pre>
              </div>
            )}
            {detailResult && (
              <div className={`rp-section${selected.isError ? " is-error" : ""}`}>
                <div className="rp-section-label">结果</div>
                <pre>{detailResult}</pre>
              </div>
            )}
            {!detailArgs && !detailResult && (
              <div className="rp-empty">暂无参数/结果</div>
            )}
          </>
        ) : (
          <div className="rp-empty">选择左侧工具查看详情</div>
        )}
      </div>
    </div>
  );
}
