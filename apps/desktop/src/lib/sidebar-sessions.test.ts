/** Calendar grouping must respect project/type boundaries while preserving original session order. */
import { describe, expect, it } from "vitest";
import type { SessionInfo, SessionType } from "@shared/ipc";
import { sidebarSessionGroups } from "./sidebar-sessions";

/** Build local timestamps so these boundary checks run consistently on every Windows timezone. */
function session(name: string, date: Date, cwd = "D:\\Projects\\Moonfall", sessionType: SessionType = "code"): SessionInfo {
  return { id: name, name, path: `${name}.jsonl`, cwd, sessionType, updatedAt: date.toISOString() };
}

describe("sidebarSessionGroups", () => {
  it("filters Windows project aliases and session type without mutating history", () => {
    const now = new Date(2026, 9, 21, 14);
    const history = [session("old", new Date(2026, 9, 20)), session("other project", now, "D:\\Other"), session("design", now, undefined, "design"), session("new", now, "d:/projects/moonfall/")];
    const groups = sidebarSessionGroups(history, "D:\\Projects\\Moonfall", "code", now);
    expect(groups.map((group) => [group.label, group.sessions.map((item) => item.name)])).toEqual([["今天", ["new"]], ["昨天", ["old"]]]);
    expect(history[0].name).toBe("old");
  });

  it("uses local midnight at month and year transitions", () => {
    const now = new Date(2026, 0, 1, 12);
    const history = [session("before yesterday", new Date(2025, 11, 30, 23, 59)), session("yesterday", new Date(2025, 11, 31, 23, 59)), session("today", new Date(2026, 0, 1))];
    expect(sidebarSessionGroups(history, null, "code", now).map((group) => group.label)).toEqual(["今天", "昨天", "更早"]);
  });
});
