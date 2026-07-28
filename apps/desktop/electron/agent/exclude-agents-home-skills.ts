import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

/** Absolute `~/.agents/skills` root (Pi auto-loads this; X-agent excludes it). */
export function getUserAgentsSkillsRoot(): string {
  return resolve(join(homedir(), ".agents", "skills"));
}

/**
 * True when `filePath` is the user-home Agents skills dir or a file under it.
 * Project `.agents/skills` trees elsewhere are not matched.
 */
export function isUnderUserAgentsSkills(filePath: string): boolean {
  if (!filePath) return false;
  const root = getUserAgentsSkillsRoot();
  const abs = resolve(filePath);
  const rootKey = process.platform === "win32" ? root.toLowerCase() : root;
  const absKey = process.platform === "win32" ? abs.toLowerCase() : abs;
  if (absKey === rootKey) return true;
  const prefix = rootKey.endsWith(sep) ? rootKey : `${rootKey}${sep}`;
  return absKey.startsWith(prefix);
}

/** Filter for DefaultResourceLoader `skillsOverride`. */
export function excludeUserAgentsHomeSkills<T extends { filePath: string }>(
  skills: T[],
): T[] {
  return skills.filter((s) => !isUnderUserAgentsSkills(s.filePath));
}
