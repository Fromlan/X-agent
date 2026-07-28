import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Loader2,
  PanelRight,
  Wrench,
  XCircle,
} from "lucide-react";

interface Props {
  toolCallId: string;
  toolName: string;
  args: string;
  result: string;
  isError?: boolean;
  done: boolean;
  onOpenInPanel?: () => void;
}

export function ToolCard({
  toolCallId,
  toolName,
  args,
  result,
  isError,
  done,
  onOpenInPanel,
}: Props) {
  // Running: keep expanded and show body. After done: auto-collapse; user can re-open.
  const [open, setOpen] = useState(!done);

  useEffect(() => {
    setOpen(!done);
  }, [done]);

  const stateIcon = !done ? (
    <Loader2 size={12} className="icon-spin" />
  ) : isError ? (
    <XCircle size={12} />
  ) : (
    <CheckCircle2 size={12} />
  );

  const stateText = done ? (isError ? "失败" : "完成") : "执行中…";
  const hasBody = Boolean(args || result);

  return (
    <details
      className={[
        "bubble-tool",
        done ? "toolcall-done" : "",
        isError ? "toolcall-error" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      data-tool-call-id={toolCallId}
    >
      <summary className="tool-head">
        <span className="tool-name">
          {hasBody && (
            <ChevronRight size={12} className="tool-chevron" aria-hidden />
          )}
          <Wrench size={12} />
          {toolName}
        </span>
        <span className="tool-state" title={stateText}>
          {onOpenInPanel && (
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon tool-open-panel"
              title="在工具面板中打开"
              aria-label="在工具面板中打开"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenInPanel();
              }}
            >
              <PanelRight size={12} />
            </button>
          )}
          {stateIcon}
          <span className="tool-state-label">{stateText}</span>
        </span>
      </summary>
      {args && (
        <div className="tool-section">
          <div className="tool-section-label">参数</div>
          <pre>{args}</pre>
        </div>
      )}
      {result && (
        <div className="tool-section">
          <div className="tool-section-label">结果</div>
          <pre>{result}</pre>
        </div>
      )}
    </details>
  );
}
