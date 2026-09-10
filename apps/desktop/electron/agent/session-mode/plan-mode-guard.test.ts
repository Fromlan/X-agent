/**
 * Vitest unit test for `electron/agent/session-mode/plan-mode-guard`.
 *
 * Hard-gate the Ask / Plan modes' tool surface:
 *  - Agent mode: never blocks (the only mode allowed to mutate state).
 *  - Ask / Plan: only read tools and write_plan; bash must pass the read-only
 *    classifier AND stay inside the project cwd; read/grep/find/ls must keep
 *    their `path` argument inside cwd or a plugin-readable root.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  shouldBlockReadonlyModeToolCall,
  createPlanModeGuardExtension,
} from "./plan-mode-guard";

describe("shouldBlockReadonlyModeToolCall (Ask/Plan hard gate)", () => {
  describe("mode gating", () => {
    it("agent mode never blocks any tool", () => {
      expect(
        shouldBlockReadonlyModeToolCall(
          "agent",
          "write",
          ["write", "bash"],
          { path: "/tmp/foo" },
          "/tmp",
        ).block,
      ).toBe(false);
      expect(
        shouldBlockReadonlyModeToolCall(
          "agent",
          "bash",
          ["bash"],
          { command: "rm -rf /" },
          "/tmp",
        ).block,
      ).toBe(false);
    });

    it("ask + tool in allowlist → not blocked", () => {
      expect(
        shouldBlockReadonlyModeToolCall(
          "ask",
          "read",
          ["read"],
          { path: "src/index.ts" },
          "/tmp",
        ).block,
      ).toBe(false);
    });

    it("plan + tool not in allowlist → blocked with plan-mode message", () => {
      const r = shouldBlockReadonlyModeToolCall(
        "plan",
        "write",
        ["read", "write_plan"],
        { path: "src/index.ts" },
        "/tmp",
      );
      expect(r.block).toBe(true);
      expect(r.reason).toMatch(/Plan 模式/);
    });

    it("ask + tool not in allowlist → blocked with ask-mode message", () => {
      const r = shouldBlockReadonlyModeToolCall(
        "ask",
        "edit",
        ["read"],
        { path: "src/index.ts" },
        "/tmp",
      );
      expect(r.block).toBe(true);
      expect(r.reason).toMatch(/调研模式/);
    });
  });

  describe("bash gating", () => {
    it("ask + bash not in allowlist → blocked", () => {
      const r = shouldBlockReadonlyModeToolCall(
        "ask",
        "bash",
        ["read"],
        { command: "ls" },
        "/tmp",
      );
      expect(r.block).toBe(true);
      expect(r.reason).toMatch(/调研模式/);
    });

    it("ask + bash in allowlist + readonly cmd → not blocked (cwd inside)", () => {
      const cwd = mkdtempSync(join(tmpdir(), "x-agent-pmg-"));
      expect(
        shouldBlockReadonlyModeToolCall(
          "ask",
          "bash",
          ["bash"],
          { command: "ls" },
          cwd,
        ).block,
      ).toBe(false);
    });

    it("ask + bash non-readonly cmd → blocked", () => {
      const r = shouldBlockReadonlyModeToolCall(
        "ask",
        "bash",
        ["bash"],
        { command: "rm -rf /" },
        "/tmp",
      );
      expect(r.block).toBe(true);
      expect(r.reason).toBeTruthy();
    });

    it("ask + bash readonly cmd but escapes cwd → blocked", () => {
      const cwd = mkdtempSync(join(tmpdir(), "x-agent-pmg-cwd-"));
      const r = shouldBlockReadonlyModeToolCall(
        "ask",
        "bash",
        ["bash"],
        { command: "cat /etc/passwd" },
        cwd,
      );
      expect(r.block).toBe(true);
    });

    it("ask + bash without cwd → readonly cmd allowed (cwd check skipped)", () => {
      expect(
        shouldBlockReadonlyModeToolCall(
          "ask",
          "bash",
          ["bash"],
          { command: "ls" },
        ).block,
      ).toBe(false);
    });
  });

  describe("path-tool gating (read/grep/find/ls)", () => {
    const cwd = mkdtempSync(join(tmpdir(), "x-agent-pmg-paths-"));

    it("path escaping cwd via `..` → blocked", () => {
      const r = shouldBlockReadonlyModeToolCall(
        "ask",
        "read",
        ["read"],
        { path: "../outside.ts" },
        cwd,
      );
      expect(r.block).toBe(true);
      expect(r.reason).toMatch(/调研\/Plan 模式禁止/);
    });

    it("path inside cwd → not blocked", () => {
      const r = shouldBlockReadonlyModeToolCall(
        "ask",
        "grep",
        ["grep"],
        { path: "src/index.ts" },
        cwd,
      );
      expect(r.block).toBe(false);
    });

    it("absolute path outside cwd → blocked", () => {
      const r = shouldBlockReadonlyModeToolCall(
        "plan",
        "find",
        ["find"],
        { path: "C:\\Windows\\System32" },
        cwd,
      );
      expect(r.block).toBe(true);
    });

    it("path with `~` expansion to home is blocked when home is not a plugin root", () => {
      const r = shouldBlockReadonlyModeToolCall(
        "ask",
        "read",
        ["read"],
        { path: "~/.ssh/id_rsa" },
        cwd,
      );
      expect(r.block).toBe(true);
    });

    it("non-string path → blocked", () => {
      const r = shouldBlockReadonlyModeToolCall(
        "ask",
        "read",
        ["read"],
        { path: 42 },
        cwd,
      );
      expect(r.block).toBe(true);
    });

    it("missing path arg → not blocked (default = cwd itself)", () => {
      const r = shouldBlockReadonlyModeToolCall(
        "ask",
        "read",
        ["read"],
        {},
        cwd,
      );
      expect(r.block).toBe(false);
    });

    it("godot_detect_project path-tool is covered by the same gate", () => {
      const r = shouldBlockReadonlyModeToolCall(
        "ask",
        "godot_detect_project",
        ["godot_detect_project"],
        { path: "../escape" },
        cwd,
      );
      expect(r.block).toBe(true);
    });
  });
});

describe("createPlanModeGuardExtension (InlineExtension factory)", () => {
  it("returns an InlineExtension-shaped callable", () => {
    const ext = createPlanModeGuardExtension({
      getMode: () => "ask",
      getAllowedTools: () => ["read"],
      getCwd: () => "/tmp",
    });
    expect(typeof ext).toBe("function");
  });

  it("the returned extension does not throw on construction", () => {
    expect(() =>
      createPlanModeGuardExtension({
        getMode: () => "plan",
        getAllowedTools: () => ["bash"],
        getCwd: () => "/tmp",
      }),
    ).not.toThrow();
  });
});
