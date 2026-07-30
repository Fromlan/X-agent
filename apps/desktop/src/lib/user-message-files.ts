/**
 * Display helpers for expanded `@path` payloads stored as Pi
 * `<file name="…">…</file>` blocks in user messages.
 */

export type UserMessageSegment =
  | { kind: "text"; text: string }
  | { kind: "file"; name: string; content: string };

const FILE_BLOCK_RE =
  /<file\s+name="([^"]*)"\s*>\r?\n?([\s\S]*?)\r?\n?<\/file>/g;

/** Split stored user text into plain runs and expanded file blocks. */
export function splitUserMessageFileBlocks(text: string): UserMessageSegment[] {
  if (!text) return [{ kind: "text", text: "" }];
  const segments: UserMessageSegment[] = [];
  let last = 0;
  FILE_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_BLOCK_RE.exec(text)) !== null) {
    if (match.index > last) {
      segments.push({ kind: "text", text: text.slice(last, match.index) });
    }
    segments.push({
      kind: "file",
      name: match[1] ?? "",
      content: match[2] ?? "",
    });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    segments.push({ kind: "text", text: text.slice(last) });
  }
  if (segments.length === 0) {
    return [{ kind: "text", text }];
  }
  return segments;
}

export function userMessageHasFileBlocks(text: string): boolean {
  FILE_BLOCK_RE.lastIndex = 0;
  return FILE_BLOCK_RE.test(text);
}
