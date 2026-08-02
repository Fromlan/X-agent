/**
 * Display helpers for expanded payloads stored in user messages:
 * `<file>` / `<mode>` / `<skill>` / `<prompt>`.
 */

import { MODE_BLOCK_RE } from "@shared/mode-prompt";

export type UserMessageSegment =
  | { kind: "text"; text: string }
  | { kind: "file"; name: string; content: string }
  | { kind: "mode"; name: string; content: string }
  | { kind: "skill"; name: string; content: string; location?: string }
  | { kind: "prompt"; name: string; content: string; args?: string };

export const FILE_BLOCK_RE =
  /<file\s+name="([^"]*)"\s*>\r?\n?([\s\S]*?)\r?\n?<\/file>/g;

export const SKILL_BLOCK_RE =
  /<skill\s+name="([^"]*)"(?:\s+location="([^"]*)")?\s*>\r?\n?([\s\S]*?)\r?\n?<\/skill>/g;

export const PROMPT_BLOCK_RE =
  /<prompt\s+name="([^"]*)"(?:\s+args="([^"]*)")?\s*>\r?\n?([\s\S]*?)\r?\n?<\/prompt>/g;

const BLOCK_RE =
  /<(file|mode|skill|prompt)\s+([^>]*)>(\r?\n)?([\s\S]*?)\r?\n?<\/\1>/g;

function parseAttrs(attrStr: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrStr)) !== null) {
    out[m[1]!] = m[2] ?? "";
  }
  return out;
}

function decodeAttr(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

/** Split stored user text into plain runs and collapsible chips. */
export function splitUserMessageFileBlocks(text: string): UserMessageSegment[] {
  if (!text) return [{ kind: "text", text: "" }];
  if (
    !text.includes("<file") &&
    !text.includes("<mode") &&
    !text.includes("<skill") &&
    !text.includes("<prompt")
  ) {
    return [{ kind: "text", text }];
  }

  const segments: UserMessageSegment[] = [];
  let last = 0;
  BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BLOCK_RE.exec(text)) !== null) {
    if (match.index > last) {
      segments.push({ kind: "text", text: text.slice(last, match.index) });
    }
    const tag = match[1] ?? "";
    const attrs = parseAttrs(match[2] ?? "");
    const content = match[4] ?? "";
    if (tag === "file") {
      segments.push({
        kind: "file",
        name: attrs.name ?? "",
        content,
      });
    } else if (tag === "mode") {
      segments.push({
        kind: "mode",
        name: attrs.name ?? "",
        content,
      });
    } else if (tag === "skill") {
      segments.push({
        kind: "skill",
        name: attrs.name ?? "",
        content,
        ...(attrs.location ? { location: attrs.location } : {}),
      });
    } else if (tag === "prompt") {
      segments.push({
        kind: "prompt",
        name: attrs.name ?? "",
        content,
        ...(attrs.args ? { args: decodeAttr(attrs.args) } : {}),
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

export function userMessageHasSkillBlocks(text: string): boolean {
  SKILL_BLOCK_RE.lastIndex = 0;
  return SKILL_BLOCK_RE.test(text);
}

export function userMessageHasPromptBlocks(text: string): boolean {
  PROMPT_BLOCK_RE.lastIndex = 0;
  return PROMPT_BLOCK_RE.test(text);
}

export function userMessageHasEmbeddedBlocks(text: string): boolean {
  return (
    userMessageHasFileBlocks(text) ||
    userMessageHasModeBlocks(text) ||
    userMessageHasSkillBlocks(text) ||
    userMessageHasPromptBlocks(text)
  );
}
