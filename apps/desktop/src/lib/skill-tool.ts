/**
 * Detect Pi skill loads: model `read` of a skill's SKILL.md.
 * (There is no dedicated skill tool event — invocation is a read of the file.)
 */

export type SkillReadInfo = {
  /** Skill directory name (usually frontmatter `name`). */
  skillName: string;
  /** Absolute or relative path that was read. */
  path: string;
};

function pathFromArgs(args: unknown): string | null {
  if (args == null) return null;
  if (typeof args === "object" && !Array.isArray(args)) {
    const path = (args as { path?: unknown }).path;
    if (typeof path === "string" && path.trim()) return path.trim();
    return null;
  }
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (!trimmed) return null;
    try {
      return pathFromArgs(JSON.parse(trimmed) as unknown);
    } catch {
      // formatMaybeJson may leave a bare path in odd cases — accept SKILL.md paths.
      if (/SKILL\.md$/i.test(trimmed.replace(/\\/g, "/"))) return trimmed;
      return null;
    }
  }
  return null;
}

/**
 * If this tool call is loading a skill via `read` …/SKILL.md, return its info.
 */
export function parseSkillReadFromTool(
  toolName: string,
  args: unknown,
): SkillReadInfo | null {
  if (toolName !== "read") return null;
  const path = pathFromArgs(args);
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/");
  if (!/\/SKILL\.md$/i.test(normalized) && !/^SKILL\.md$/i.test(normalized)) {
    return null;
  }
  const parts = normalized.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p.toLowerCase() === "skill.md");
  if (idx <= 0) return null;
  const skillName = parts[idx - 1]!.trim();
  if (!skillName) return null;
  return { skillName, path };
}
