/**
 * Display helpers for expanded `@path` payloads and mode instruction blocks
 * stored in user messages (`<file>` / `<mode>`).
 */

import { MODE_BLOCK_RE } from "@shared/mode-prompt";

export type UserMessageSegment =
  | { kind: "text"; text: string }
  | { kind: "file"; name: string; content: string }
  | { kind: "mode"; name: string; content: string };

const FILE_BLOCK_RE =
  /<file\s+name="([^"]*)"\s*>\r?\n?([\s\S]*?)\r?\n?<\/file>/g;

const COMBINED_BLOCK_RE =
  /<(file)\s+name="([^"]*)"\s*>\r?\n?([\s\S]*?)\r?\n?<\/file>|<(mode)\s+name="([^"]*)"\s*>\r?\n?([\s\S]*?)\r?\n?<\/mode>/g;

/** Split stored user text into plain runs, file refs, and mode chips. */
export function splitUserMessageFileBlocks(text: string): UserMessageSegment[] {
  if (!text) return [{ kind: "text", text: "" }];
  if (!text.includes("<file") && !text.includes("<mode")) {
    return [{ kind: "text", text }];
  }

  const segments: UserMessageSegment[] = [];
  let last = 0;
  COMBINED_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = COMBINED_BLOCK_RE.exec(text)) !== null) {
    if (match.index > last) {
      segments.push({ kind: "text", text: text.slice(last, match.index) });
    }
    if (match[1] === "file") {
      segments.push({
        kind: "file",
        name: match[2] ?? "",
        content: match[3] ?? "",
      });
    } else {
      segments.push({
        kind: "mode",
        name: match[5] ?? "",
        content: match[6] ?? "",
      });
    }
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

export function userMessageHasModeBlocks(text: string): boolean {
  MODE_BLOCK_RE.lastIndex = 0;
  return MODE_BLOCK_RE.test(text);
}

export function userMessageHasEmbeddedBlocks(text: string): boolean {
  return userMessageHasFileBlocks(text) || userMessageHasModeBlocks(text);
}
