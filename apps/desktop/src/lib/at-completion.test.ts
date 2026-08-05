/**
 * Vitest 套件 —— 锁住 @-补全检测 / 过滤 / 插入契约。
 */
import { describe, it, expect } from "vitest";
import {
  detectAtFragment,
  filterPathCandidates,
  filterSkillCandidates,
  filterModeCandidates,
  applyAtItemInsert,
  atCategoryLabel,
  looksLikePathCandidate,
} from "./at-completion";

describe("detectAtFragment", () => {
  it("字符串开头 @触发 path 类别", () => {
    const m = detectAtFragment("@sc", 3);
    expect(m).not.toBeNull();
    expect(m?.category).toBe("path");
    expect(m?.query).toBe("sc");
    expect(m?.start).toBe(0);
    expect(m?.end).toBe(3);
  });

  it("空白后 @触发 path 类别", () => {
    const m = detectAtFragment("hello @play", 11);
    expect(m?.category).toBe("path");
    expect(m?.query).toBe("play");
    expect(m?.start).toBe(6);
  });

  it("@skill:foo 归类为 skill", () => {
    const m = detectAtFragment("@skill:review", 13);
    expect(m?.category).toBe("skill");
    expect(m?.prefix).toBe("skill");
    expect(m?.query).toBe("review");
  });

  it("@mode:plan 归类为 mode", () => {
    const m = detectAtFragment("@mode:plan", 10);
    expect(m?.category).toBe("mode");
    expect(m?.query).toBe("plan");
  });

  it("邮箱地址不触发", () => {
    const m = detectAtFragment("mail user@example.com", 21);
    expect(m).toBeNull();
  });

  it("@ 后紧跟空白不触发（已脱离）", () => {
    const m = detectAtFragment("@ ", 2);
    expect(m).toBeNull();
  });

  it("光标超出 input 时安全 clamp", () => {
    const m = detectAtFragment("@x", 99);
    expect(m?.category).toBe("path");
    expect(m?.query).toBe("x");
  });

  it("无 @ 时返回 null", () => {
    expect(detectAtFragment("plain text", 5)).toBeNull();
  });
});

describe("filterPathCandidates", () => {
  const paths = [
    "src/main.gd",
    "src/player.gd",
    "scenes/main.tscn",
    "scripts/util.gd",
    "README.md",
  ];

  it("空 query 返回前 30 个", () => {
    expect(filterPathCandidates(paths, "").length).toBe(5);
  });

  it("按子串过滤（不区分大小写）", () => {
    expect(filterPathCandidates(paths, "PLAYER")).toEqual(["src/player.gd"]);
  });

  it("空白 query 视为空", () => {
    expect(filterPathCandidates(paths, "   ")).toEqual(paths);
  });

  it("无匹配返回空数组", () => {
    expect(filterPathCandidates(paths, "nope")).toEqual([]);
  });
});

describe("filterSkillCandidates", () => {
  const items = [
    { name: "review", description: "code review" },
    { name: "safe-edit", description: "safety check" },
    { name: "grill", description: "ask hard questions" },
  ];

  it("按 name 子串过滤", () => {
    expect(filterSkillCandidates(items, "re").map((i) => i.name)).toEqual([
      "review",
    ]);
  });

  it("按 description 过滤", () => {
    expect(filterSkillCandidates(items, "safety").map((i) => i.name)).toEqual([
      "safe-edit",
    ]);
  });

  it("name 或 description 命中即返回", () => {
    expect(filterSkillCandidates(items, "hard").map((i) => i.name)).toEqual([
      "grill",
    ]);
  });
});

describe("filterModeCandidates", () => {
  it("返回全部 4 个模式", () => {
    expect(filterModeCandidates("").length).toBe(4);
  });

  it("按 id 过滤", () => {
    expect(filterModeCandidates("pl").map((m) => m.id)).toEqual(["plan"]);
  });

  it("按 label 过滤（中文）", () => {
    expect(filterModeCandidates("调研").map((m) => m.id)).toEqual(["ask"]);
  });
});

describe("applyAtItemInsert", () => {
  it("path 插入到字符串开头", () => {
    const match = detectAtFragment("@sc", 3)!;
    const r = applyAtItemInsert("@sc", match, { kind: "path", id: "src/main.gd" });
    expect(r.value).toBe("@src/main.gd");
    expect(r.cursor).toBe("@src/main.gd".length);
  });

  it("skill 转写为 /skill:name ", () => {
    const match = detectAtFragment("@skill:rev", 11)!;
    const r = applyAtItemInsert("@skill:rev", match, { kind: "skill", id: "review" });
    expect(r.value).toBe("/skill:review ");
    expect(r.cursor).toBe("/skill:review ".length);
  });

  it("mode 转写为 /mode plan ", () => {
    const match = detectAtFragment("@mode:pl", 9)!;
    const r = applyAtItemInsert("@mode:pl", match, { kind: "mode", id: "plan" });
    expect(r.value).toBe("/mode plan ");
    expect(r.cursor).toBe("/mode plan ".length);
  });

  it("保留插入位置之前的文本", () => {
    const match = detectAtFragment("hi @sc", 6)!;
    const r = applyAtItemInsert("hi @sc", match, { kind: "path", id: "src/foo.gd" });
    expect(r.value).toBe("hi @src/foo.gd");
  });
});

describe("atCategoryLabel", () => {
  it("三类都有非空中文标签", () => {
    expect(atCategoryLabel("path").length).toBeGreaterThan(0);
    expect(atCategoryLabel("skill").length).toBeGreaterThan(0);
    expect(atCategoryLabel("mode").length).toBeGreaterThan(0);
  });
});

describe("looksLikePathCandidate", () => {
  it("普通相对路径片段视为候选", () => {
    expect(looksLikePathCandidate("src/main.gd")).toBe(true);
  });

  it("URL 不视为 path 候选", () => {
    expect(looksLikePathCandidate("https://")).toBe(false);
  });

  it("空白不视为 path 候选", () => {
    expect(looksLikePathCandidate("foo bar")).toBe(false);
  });
});
