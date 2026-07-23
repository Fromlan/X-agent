import { CheckCircle2, Loader2, Wrench, XCircle } from "lucide-react";

interface Props {
  toolName: string;
  args: string;
  result: string;
  isError?: boolean;
  done: boolean;
}

export function ToolCard({ toolName, args, result, isError, done }: Props) {
  const stateIcon = !done ? (
    <Loader2 size={13} className="icon-spin" />
  ) : isError ? (
    <XCircle size={13} />
  ) : (
    <CheckCircle2 size={13} />
  );

  const stateText = done ? (isError ? "失败" : "完成") : "执行中…";

  return (
    <div
      className={[
        "bubble-tool",
        done ? "toolcall-done" : "",
        isError ? "toolcall-error" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="tool-head">
        <span className="tool-name">
          <Wrench size={13} />
          {toolName}
        </span>
        <span className="tool-state">
          {stateIcon}
          {stateText}
        </span>
      </div>
      {args && (
        <details>
          <summary>参数</summary>
          <pre>{args}</pre>
        </details>
      )}
      {result && (
        <details open={Boolean(isError) || done}>
          <summary>结果</summary>
          <pre>{result}</pre>
        </details>
      )}
    </div>
  );
}
