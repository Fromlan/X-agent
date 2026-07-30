import { useState } from "react";
import { ChevronRight, FileText } from "lucide-react";
import {
  splitUserMessageFileBlocks,
  type UserMessageSegment,
} from "../lib/user-message-files";

function FileRefChip({ name, content }: { name: string; content: string }) {
  const [open, setOpen] = useState(false);
  const label = name.trim() || "file";
  const lines = content ? content.split(/\r?\n/).length : 0;

  return (
    <details
      className="user-file-ref"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="user-file-ref-summary" title={label}>
        <ChevronRight size={12} className="user-file-ref-chevron" aria-hidden />
        <FileText size={12} aria-hidden />
        <span className="user-file-ref-at">@{label}</span>
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
  if (!seg.text) return null;
  return (
    <pre key={key} className="user-message-text">
      {seg.text}
    </pre>
  );
}

/** Render user bubble text with expanded `<file>` blocks as collapsed @chips. */
export function UserMessageBody({ text }: { text: string }) {
  const segments = splitUserMessageFileBlocks(text);
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
