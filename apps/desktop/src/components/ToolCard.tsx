import { useEffect, useMemo, useRef } from "react";
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Loader2,
  PanelRight,
  Wrench,
  XCircle,
} from "lucide-react";
import { parseSkillReadFromTool } from "../lib/skill-tool";

interface Props {
  toolCallId: string;
  toolName: string;
  /** Raw tool args or already pretty-printed JSON string. */
  args: unknown;
  result: string;
  isError?: boolean;
  done: boolean;
  onOpenInPanel?: () => void;
}

function formatArgsDisplay(args: unknown): string {
  if (args == null) return "";
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

/**
 * Decide details open state when `done` changes.
 * - running → keep/force open
 * - just finished → force closed (once)
 * - already done → leave user toggle alone (`null`)
 */
export function toolDetailsOpenForDoneTransition(
  prevDone: boolean,
  done: boolean,
): boolean | null {
  if (!done) return true;
  if (!prevDone && done) return false;
  return null;
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
  // Uncontrolled <details>: controlling `open` + onToggle races in Chromium and
  // often leaves finished tools stuck expanded. Imperatively sync on done edges.
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const prevDoneRef = useRef(done);

  const skill = useMemo(
    () => parseSkillReadFromTool(toolName, args),
    [toolName, args],
  );
  const argsText = useMemo(() => {
    if (skill) return skill.path;
    return formatArgsDisplay(args);
  }, [skill, args]);

  useEffect(() => {
    const el = detailsRef.current;
    if (!el) return;
    const next = toolDetailsOpenForDoneTransition(prevDoneRef.current, done);
    prevDoneRef.current = done;
    if (next === null) return;
    el.open = next;
  }, [done]);

  // History / late-mount: if already done on first paint, start collapsed.
  useEffect(() => {
    const el = detailsRef.current;
    if (!el) return;
    el.open = !done;
    prevDoneRef.current = done;
    // intentionally mount-only for initial open; subsequent edges use the effect above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stateIcon = !done ? (
    <Loader2 size={12} className="icon-spin" />
  ) : isError ? (
    <XCircle size={12} />
  ) : (
    <CheckCircle2 size={12} />
  );

  const stateText = done ? (isError ? "失败" : "完成") : "执行中…";
  const hasBody = Boolean(argsText || result || skill);
  const titleLabel = skill ? `技能 · ${skill.skillName}` : toolName;
  const Icon = skill ? BookOpen : Wrench;

  return (
    <details
      ref={detailsRef}
      className={[
        "bubble-tool",
        skill ? "is-skill" : "",
        done ? "toolcall-done" : "",
        isError ? "toolcall-error" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-tool-call-id={toolCallId}
      data-skill-name={skill?.skillName}
    >
      <summary className="tool-head">
        <span className="tool-name">
          {hasBody && (
            <ChevronRight size={12} className="tool-chevron" aria-hidden />
          )}
          <Icon size={12} />
          {titleLabel}
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
      {skill && (
        <div className="tool-section">
          <div className="tool-section-label">技能</div>
          <pre>{skill.skillName}</pre>
        </div>
      )}
      {argsText && (
        <div className="tool-section">
          <div className="tool-section-label">{skill ? "路径" : "参数"}</div>
          <pre>{argsText}</pre>
        </div>
      )}
      {skill && done && !isError && (
        <div className="tool-section">
          <div className="tool-section-label">结果</div>
          <pre className="tool-skill-loaded">已加载技能说明</pre>
        </div>
      )}
      {!skill && result && (
        <div className="tool-section">
          <div className="tool-section-label">结果</div>
          <pre>{result}</pre>
        </div>
      )}
      {skill && isError && result && (
        <div className="tool-section">
          <div className="tool-section-label">结果</div>
          <pre>{result}</pre>
        </div>
      )}
    </details>
  );
}
