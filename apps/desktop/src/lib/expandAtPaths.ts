/**
 * Expand `@rel/path` tokens in a composer prompt the way Pi CLI does
 * (`<file name="…">…content…</file>`). Directories and failed reads keep
 * the original `@path` so the model can use tools.
 */

import { stripModeBlocks } from "@shared/mode-prompt";
import {
  FILE_BLOCK_RE,
  PROMPT_BLOCK_RE,
  SKILL_BLOCK_RE,
} from "./user-message-files";

const AT_PATH_RE = /(?<![\w.])@([A-Za-z0-9_./\\-]+)/g;

export function appendAtPath(input: string, relPath: string): string {
  const token = `@${relPath.replace(/\\/g, "/")}`;
  if (!input) return token;
  if (/\s$/.test(input)) return `${input}${token}`;
  return `${input} ${token}`;
}

/**
 * Inverse of expand for UI: put `@path` back, collapse skill/prompt to slash
 * tokens, and drop mode instruction blocks so composer / edit drafts stay
 * compact. Re-send expands `@path` again and re-wraps mode instructions.
 */
export function collapseFileBlocksToAtPaths(text: string): string {
  let out = text.includes("<mode") ? stripModeBlocks(text) : text;
  if (out.includes("<skill")) {
    SKILL_BLOCK_RE.lastIndex = 0;
    out = out.replace(SKILL_BLOCK_RE, (_full, name: string) => {
      const id = String(name ?? "").trim();
      return id ? `/skill:${id}` : "";
    });
  }
  if (out.includes("<prompt")) {
    PROMPT_BLOCK_RE.lastIndex = 0;
    out = out.replace(
      PROMPT_BLOCK_RE,
      (_full, name: string, args: string | undefined) => {
        const id = String(name ?? "").trim();
        if (!id) return "";
        const argsTrim = String(args ?? "")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&")
          .trim();
        return argsTrim ? `/${id} ${argsTrim}` : `/${id}`;
      },
    );
  }
  if (!out.includes("<file")) {
    return out.replace(/\n{3,}/g, "\n\n").trimEnd();
  }
  out = out.replace(FILE_BLOCK_RE, (_full, name: string) => {
    const rel = String(name ?? "")
      .trim()
      .replace(/\\/g, "/");
    return rel ? `@${rel}` : "@";
  });
  return out.replace(/\n{3,}/g, "\n\n").trimEnd();
}

export async function expandAtPathsInPrompt(text: string): Promise<string> {
  const matches = [...text.matchAll(AT_PATH_RE)];
  if (matches.length === 0) return text;

  const unique = [
    ...new Set(matches.map((m) => m[1].replace(/\\/g, "/"))),
  ];
  const expansions = new Map<string, string | null>();

  await Promise.all(
    unique.map(async (rel) => {
      const res = await window.xAgent.readProjectFile(rel);
      if (res.ok && res.content != null) {
        expansions.set(
          rel,
          `<file name="${rel}">\n${res.content}\n</file>`,
        );
        return;
      }
      // Directory ("不是文件") or other failures: leave @path as-is.
      expansions.set(rel, null);
    }),
  );

  return text.replace(AT_PATH_RE, (full, rawPath: string) => {
    const rel = rawPath.replace(/\\/g, "/");
    return expansions.get(rel) ?? full;
  });
}
