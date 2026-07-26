import assert from "node:assert/strict";
import type { SessionInfo } from "../shared/ipc.ts";
import {
  groupSessionsByProject,
  normalizeProjectKey,
  projectDisplayName,
} from "../src/lib/group-sessions.ts";

assert.equal(normalizeProjectKey(""), "");
assert.equal(normalizeProjectKey("  "), "");
assert.equal(
  normalizeProjectKey("D:\\Games\\MyGame"),
  normalizeProjectKey("d:/Games/MyGame/"),
);

assert.equal(projectDisplayName(""), "未知项目");
assert.equal(projectDisplayName("D:\\Games\\MyGame"), "MyGame");
assert.equal(projectDisplayName("/home/user/proj"), "proj");

const sessions: SessionInfo[] = [
  {
    id: "1",
    name: "old-a",
    path: "/s/1.jsonl",
    cwd: "D:\\Games\\Alpha",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "2",
    name: "new-a",
    path: "/s/2.jsonl",
    cwd: "d:/Games/Alpha",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "3",
    name: "beta",
    path: "/s/3.jsonl",
    cwd: "D:\\Games\\Beta",
    updatedAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "4",
    name: "orphan",
    path: "/s/4.jsonl",
    cwd: "",
    updatedAt: "2026-05-01T00:00:00.000Z",
  },
];

const groups = groupSessionsByProject(sessions);
assert.equal(groups.length, 3);
assert.equal(groups[0].label, "Beta");
assert.equal(groups[0].sessions.length, 1);
assert.equal(groups[1].label, "Alpha");
assert.equal(groups[1].sessions.map((s) => s.id).join(","), "2,1");
assert.equal(groups[2].label, "未知项目");
assert.equal(groups[2].key, "");

console.log("test-group-sessions: ok");
