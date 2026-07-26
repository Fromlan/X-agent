/** Shared project path helpers for sidebar grouping / hide keys. */

/** Normalize project paths so Windows case / slash variants share one key. */
export function normalizeProjectKey(cwd: string): string {
  const trimmed = cwd.trim();
  if (!trimmed) return "";
  return trimmed.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Last path segment for display; empty cwd → 未知项目. */
export function projectDisplayName(cwd: string): string {
  const trimmed = cwd.trim();
  if (!trimmed) return "未知项目";
  const posix = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = posix.split("/").filter(Boolean);
  return parts[parts.length - 1] || "未知项目";
}

/** Drop groups whose key is in the hidden set (Cursor-style remove from sidebar). */
export function filterVisibleProjectGroups<T extends { key: string }>(
  groups: T[],
  hiddenProjectKeys: readonly string[],
): T[] {
  if (hiddenProjectKeys.length === 0) return groups;
  const hidden = new Set(
    hiddenProjectKeys.map((k) => normalizeProjectKey(k)).filter(Boolean),
  );
  // Empty key ("未知项目") is never hidden via project path prefs.
  return groups.filter((g) => !g.key || !hidden.has(g.key));
}

/**
 * After deleting `excludePath`, pick the newest remaining session in the same project.
 */
export function pickFallbackSessionPath(
  sessions: ReadonlyArray<{ path: string; cwd: string; updatedAt: string }>,
  cwd: string,
  excludePath: string,
): string | null {
  const key = normalizeProjectKey(cwd);
  if (!key) return null;
  const candidates = sessions
    .filter(
      (s) =>
        s.path !== excludePath && normalizeProjectKey(s.cwd) === key,
    )
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  return candidates[0]?.path ?? null;
}
