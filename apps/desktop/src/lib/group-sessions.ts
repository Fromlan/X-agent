import type { SessionInfo } from "@shared/ipc";
import {
  normalizeProjectKey,
  projectDisplayName,
  filterVisibleProjectGroups,
} from "@shared/project-path";

export {
  normalizeProjectKey,
  projectDisplayName,
  filterVisibleProjectGroups,
} from "@shared/project-path";

export interface ProjectSessionGroup {
  key: string;
  cwd: string;
  label: string;
  sessions: SessionInfo[];
}

function updatedMs(s: SessionInfo): number {
  return new Date(s.updatedAt).getTime() || 0;
}

/** Group sessions by project cwd; groups and sessions sorted by newest first. */
export function groupSessionsByProject(sessions: SessionInfo[]): ProjectSessionGroup[] {
  const map = new Map<string, ProjectSessionGroup>();

  for (const s of sessions) {
    const key = normalizeProjectKey(s.cwd);
    const existing = map.get(key);
    if (existing) {
      existing.sessions.push(s);
      continue;
    }
    map.set(key, {
      key,
      cwd: s.cwd.trim(),
      label: projectDisplayName(s.cwd),
      sessions: [s],
    });
  }

  const groups = [...map.values()];
  for (const g of groups) {
    g.sessions.sort((a, b) => updatedMs(b) - updatedMs(a));
  }
  groups.sort((a, b) => {
    const at = a.sessions[0] ? updatedMs(a.sessions[0]) : 0;
    const bt = b.sessions[0] ? updatedMs(b.sessions[0]) : 0;
    return bt - at;
  });
  return groups;
}
