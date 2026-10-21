/** Present the selected project's session history in the date groups used by the approved layout. */
import type { SessionInfo, SessionType } from "@shared/ipc";
import { normalizeProjectKey } from "@shared/project-path";

/** Group by local calendar boundaries so yesterday remains correct across DST and month changes. */
export function sidebarSessionGroups(sessions: SessionInfo[], cwd: string | null, type: SessionType, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const key = cwd ? normalizeProjectKey(cwd) : null;
  const groups = new Map<string, SessionInfo[]>();
  const visible = sessions.filter((session) => (!key || normalizeProjectKey(session.cwd) === key) && session.sessionType === type)
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  for (const session of visible) {
    const updated = new Date(session.updatedAt);
    const label = updated >= today ? "今天" : updated >= yesterday ? "昨天" : "更早";
    const existing = groups.get(label) ?? [];
    existing.push(session);
    groups.set(label, existing);
  }
  return Array.from(groups, ([label, items]) => ({ label, sessions: items }));
}
