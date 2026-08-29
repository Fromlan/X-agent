import { useMemo, useState } from "react";
import {
  BookOpen,
  ChevronRight,
  ClipboardList,
  FileText,
  Hammer,
  ScrollText,
  Target,
} from "lucide-react";
import { modeBlockLabel } from "@shared/mode-prompt";
import {
  splitUserMessageFileBlocks,
  type UserMessageSegment,
} from "../lib/user-message-files";

function FileRefChip({ name, content }: { name: string; content: string }) {
  const [open, setOpen] = useState(false);
  const fullPath = name.trim() || "file";
  // Short display: show only the basename so chat history doesn't
  // drown in absolute paths (e.g. D:/UGit/z-2/config/01_chess.csv
  // → "01_chess.csv"). Full path lives in title attribute for hover
  // + accessibility.
  const shortName = basename(fullPath) || fullPath;
  const isEmpty = content.trim().length === 0;
  const lines = isEmpty ? 0 : content.split(/\r?\n/).length;

  return (
    <details
      className="user-file-ref"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary
        className="user-file-ref-summary"
        title={fullPath}
        aria-label={fullPath}
      >
        <ChevronRight size={12} className="user-file-ref-chevron" aria-hidden />
        <FileText size={12} aria-hidden />
        <span className="user-file-ref-at">{shortName}</span>
        {isEmpty && (
          <span className="user-file-ref-meta">未展开</span>
        )}
        {!isEmpty && lines > 0 && (
          <span className="user-file-ref-meta">{lines} 行</span>
        )}
      </summary>
      {isEmpty ? (
        <pre className="user-file-ref-body user-file-ref-body-empty">
          （文件未在 prompt 中展开；完整路径：{fullPath}）
        </pre>
      ) : (
        <pre className="user-file-ref-body">{content}</pre>
      )}
    </details>
  );
}

/** Cross-platform basename (renderer has no `path` module). */
function basename(p: string): string {
  if (!p) return "";
  const m = /([^/\\]+)[/\\]*$/.exec(p);
  return m ? m[1]! : p;
}

function ModeRefChip({ name, content }: { name: string; content: string }) {
  const [open, setOpen] = useState(false);
  const label = modeBlockLabel(name);
  const lines = content ? content.split(/\r?\n/).length : 0;
  const Icon =
    name === "goal" ? Target : name === "build" ? Hammer : ClipboardList;

  return (
    <details
      className="user-file-ref user-mode-ref"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary
        className="user-file-ref-summary"
        title={`${label} 模式指令`}
      >
        <ChevronRight size={12} className="user-file-ref-chevron" aria-hidden />
        <Icon size={12} aria-hidden />
        <span className="user-file-ref-at">@{label}</span>
        {lines > 0 && (
          <span className="user-file-ref-meta">{lines} 行</span>
        )}
      </summary>
      <pre className="user-file-ref-body">{content}</pre>
    </details>
  );
}

function SkillRefChip({
  name,
  content,
}: {
  name: string;
  content: string;
}) {
  const [open, setOpen] = useState(false);
  const label = name.trim() || "skill";
  const lines = content ? content.split(/\r?\n/).length : 0;

  return (
    <details
      className="user-file-ref user-skill-ref"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary
        className="user-file-ref-summary"
        title={`技能 · ${label}`}
      >
        <ChevronRight size={12} className="user-file-ref-chevron" aria-hidden />
        <BookOpen size={12} aria-hidden />
        <span className="user-file-ref-at">@{label}</span>
        <span className="user-file-ref-meta">技能</span>
        {lines > 0 && (
          <span className="user-file-ref-meta">{lines} 行</span>
        )}
      </summary>
      <pre className="user-file-ref-body">{content}</pre>
    </details>
  );
}

function PromptRefChip({
  name,
  content,
  args,
}: {
  name: string;
  content: string;
  args?: string;
}) {
  const [open, setOpen] = useState(false);
  const label = name.trim() || "prompt";
  const lines = content ? content.split(/\r?\n/).length : 0;
  const argsTrim = args?.trim();

  return (
    <details
      className="user-file-ref user-prompt-ref"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary
        className="user-file-ref-summary"
        title={argsTrim ? `提示词 · ${label} ${argsTrim}` : `提示词 · ${label}`}
      >
        <ChevronRight size={12} className="user-file-ref-chevron" aria-hidden />
        <ScrollText size={12} aria-hidden />
        <span className="user-file-ref-at">@{label}</span>
        <span className="user-file-ref-meta">提示词</span>
        {argsTrim ? (
          <span className="user-file-ref-meta user-file-ref-args">
            {argsTrim}
          </span>
        ) : null}
        {lines > 0 && (
          <span className="user-file-ref-meta">{lines} 行</span>
        )}
      </summary>
      <pre className="user-file-ref-body">{content}</pre>
    </details>
  );
}

function renderSegment(seg: UserMessageSegment, key: number) {
  if (seg.kind === "file") {
    return <FileRefChip key={key} name={seg.name} content={seg.content} />;
  }
  if (seg.kind === "mode") {
    return <ModeRefChip key={key} name={seg.name} content={seg.content} />;
  }
  if (seg.kind === "skill") {
    return <SkillRefChip key={key} name={seg.name} content={seg.content} />;
  }
  if (seg.kind === "prompt") {
    return (
      <PromptRefChip
        key={key}
        name={seg.name}
        content={seg.content}
        args={seg.args}
      />
    );
  }
  if (!seg.text.trim()) return null;
  return (
    <pre key={key} className="user-message-text">
      {seg.text.replace(/^\n+/, "").replace(/\n+$/, "")}
    </pre>
  );
}

/** Render user bubble text with file/mode/skill/prompt blocks as collapsed chips. */
export function UserMessageBody({ text }: { text: string }) {
  const segments = useMemo(
    () => splitUserMessageFileBlocks(text),
    [text],
  );
  const onlyPlain =
    segments.length === 1 && segments[0]?.kind === "text";
  if (onlyPlain) {
    return <pre>{text}</pre>;
  }
  return (
    <div className="user-message-body">
      {segments.map((seg, i) => renderSegment(seg, i))}
    </div>
  );
}
