/**
 * 启动期失败摘要 (主题 E #62) — push / consume 队列语义 + 32 条上限.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  consumeStartupIssues,
  pushStartupIssue,
  _resetStartupIssuesForTests,
} from "./startup-issues";

beforeEach(() => {
  _resetStartupIssuesForTests();
});

describe("boot/startup-issues", () => {
  it("push 之后再 consume 得到原顺序条目, consume 之后清空", () => {
    pushStartupIssue({ stage: "shadow_recover", message: "err-A" });
    pushStartupIssue({ stage: "godot_rpc", message: "err-B" });
    expect(consumeStartupIssues()).toEqual([
      { stage: "shadow_recover", message: "err-A" },
      { stage: "godot_rpc", message: "err-B" },
    ]);
    expect(consumeStartupIssues()).toEqual([]);
  });

  it("超过 32 条时丢弃最旧, 保留最新 32", () => {
    for (let i = 0; i < 40; i++) {
      pushStartupIssue({ stage: "godot_rpc", message: `m-${i}` });
    }
    const all = consumeStartupIssues();
    expect(all).toHaveLength(32);
    // 最新的 32 条 = m-8..m-39 (i=8..39)
    expect(all[0]!.message).toBe("m-8");
    expect(all[31]!.message).toBe("m-39");
  });

  it("空队列 consume 返回 []", () => {
    expect(consumeStartupIssues()).toEqual([]);
  });

  it("三次 stage 类型共存", () => {
    pushStartupIssue({ stage: "shadow_recover", message: "a" });
    pushStartupIssue({ stage: "godot_rpc", message: "b" });
    pushStartupIssue({ stage: "godot_pi_install", message: "c" });
    const all = consumeStartupIssues();
    expect(all.map((i) => i.stage)).toEqual([
      "shadow_recover",
      "godot_rpc",
      "godot_pi_install",
    ]);
  });
});
