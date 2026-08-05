/**
 * Vitest 套件 —— mode-prompt 模式提示组装 / mode 块解析。
 * 锁住 Ask/Plan/Goal 指令注入、wrap/strip 往返与 clarify 格式约定。
 */
import { describe, it, expect } from "vitest";
import {
  ASK_MODE_INSTRUCTIONS,
  PLAN_MODE_INSTRUCTIONS,
  GOAL_MODE_INSTRUCTIONS,
  buildAskModeSystemAppend,
  buildPlanModeSystemAppend,
  buildGoalModeSystemAppend,
  wrapWithModeBlock,
  stripModeBlocks,
  modeBlockLabel,
  MODE_BLOCK_RE,
} from "./mode-prompt";

describe("mode-prompt instructions", () => {
  it("Ask 指令禁止修改源码并列出禁用工具", () => {
    expect(ASK_MODE_INSTRUCTIONS).toContain("Do NOT modify project source files");
    expect(ASK_MODE_INSTRUCTIONS).toContain(
      "Do not use edit, write, write_plan, or mutating bash",
    );
  });

  it("Plan 指令包含 clarify 格式与 write_plan 约束", () => {
    expect(PLAN_MODE_INSTRUCTIONS).toContain("<clarify>");
    expect(PLAN_MODE_INSTRUCTIONS).toContain("write_plan");
    expect(PLAN_MODE_INSTRUCTIONS).toContain("placeholders, stubs, TODOs-as-body");
  });

  it("Goal 指令要求可验证证据", () => {
    expect(GOAL_MODE_INSTRUCTIONS).toContain("verifiable evidence");
  });
});

describe("mode-prompt builders", () => {
  it("buildAskModeSystemAppend 带标题", () => {
    expect(buildAskModeSystemAppend()).toBe(
      ["# X-agent Ask mode", ASK_MODE_INSTRUCTIONS].join("\n"),
    );
  });

  it("buildGoalModeSystemAppend 注入条件", () => {
    const out = buildGoalModeSystemAppend("all tests pass");
    expect(out).toContain("GOAL CONDITION: all tests pass");
  });
});

describe("wrapWithModeBlock / stripModeBlocks", () => {
  it("wrap 生成 <mode> 块且 strip 完全移除（指令不泄入草稿）", () => {
    const wrapped = wrapWithModeBlock("ask", "read only\nno writes");
    expect(wrapped).toContain('<mode name="ask">');
    expect(stripModeBlocks(wrapped)).toBe("");
  });

  it("wrap 保留 userText 在块后", () => {
    const wrapped = wrapWithModeBlock("plan", "p", "user says hi");
    expect(wrapped).toContain("</mode>\n\nuser says hi");
    expect(stripModeBlocks(wrapped)).toBe("user says hi");
  });

  it("无 mode 块时 strip 原样返回", () => {
    expect(stripModeBlocks("plain text")).toBe("plain text");
  });

  it("MODE_BLOCK_RE 是全局正则（lastIndex 重置后仍可复用）", () => {
    expect(MODE_BLOCK_RE.global).toBe(true);
    const m = MODE_BLOCK_RE.exec('<mode name="build">\nstep\n</mode>');
    expect(m?.[1]).toBe("build");
    expect(m?.[2]).toContain("step");
  });
});

describe("modeBlockLabel", () => {
  it("中文化标签", () => {
    expect(modeBlockLabel("ask")).toBe("调研");
    expect(modeBlockLabel("plan")).toBe("Plan");
    expect(modeBlockLabel("goal")).toBe("目标");
    expect(modeBlockLabel("build")).toBe("执行计划");
    expect(modeBlockLabel("")).toBe("mode");
  });
});
