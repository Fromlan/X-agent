import { useEffect, useState } from "react";
import { CheckCircle2, ChevronRight, Loader2, Wrench, XCircle } from "lucide-react";

interface Props {
  toolName: string;
  args: string;
  result: string;
  isError?: boolean;
  done: boolean;
}

export function ToolCard({ toolName, args, result, isError, done }: Props) {
  // Running: keep expanded and show body. After done: auto-collapse; user can re-open.
  const [open, setOpen] = useState(!done);

  useEffect(() => {
    setOpen(!done);
  }, [done]);

  const stateIcon = !done ? (
    <Loader2 size={13} className="icon-spin" />
  ) : isError ? (
    <XCircle size={13} />
  ) : (
    <CheckCircle2 size={13} />
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
    >
      <summary className="tool-head">
        <span className="tool-name">
          {hasBody && (
            <ChevronRight size={13} className="tool-chevron" aria-hidden />
          )}
          <Wrench size={13} />
          {toolName}
        </span>
        <span className="tool-state">
          {stateIcon}
          {stateText}
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
