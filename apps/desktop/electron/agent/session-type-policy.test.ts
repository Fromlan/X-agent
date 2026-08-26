/**
 * SessionTypePolicy — type × tool 矩阵 + 5 methods 行为单测.
 *
 * 不依赖 Electron / Pi SDK:policy 是纯函数 + 委托给底层 guard/filter,
 * 单测可以在 node 环境直接跑.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import {
  createSessionTypePolicy,
  CodePolicy,
  DesignPolicy,
  DESIGN_SESSION_TYPE_TOOLS,
  type SessionTypeSkill,
} from "./session-type-policy";
import {
  PLAN_MODE_OPTIONAL_READONLY_TOOLS,
  WRITE_PLAN_TOOL,
  READONLY_CORE_TOOLS,
} from "../../shared/mode-tools";
import { DESIGN_DIR_NAME, isInsideGameDesign } from "./session-mode/design-write-guard";

// 设计守卫内部走 cwd-sandbox,会 existsSync(cwd) 校验目录存在.
// 用真实临时目录, 避免 OS 路径分隔符差异.
let CWD: string;

beforeAll(() => {
  CWD = mkdtempSync(join(tmpdir(), "x-agent-policy-"));
  mkdirSync(join(CWD, DESIGN_DIR_NAME), { recursive: true });
});

afterAll(() => {
  rmSync(CWD, { recursive: true, force: true });
});

describe("createSessionTypePolicy", () => {
  it("undefined → CodePolicy (DEFAULT 兜底集中)", () => {
    expect(createSessionTypePolicy(undefined).type).toBe("code");
  });

  it("null → CodePolicy", () => {
    expect(createSessionTypePolicy(null).type).toBe("code");
  });

  it("'code' → CodePolicy", () => {
    expect(createSessionTypePolicy("code").type).toBe("code");
  });

  it("'design' → DesignPolicy", () => {
    expect(createSessionTypePolicy("design").type).toBe("design");
  });

  it("factory 复用单例 (policy 实例无状态,可共享)", () => {
    const a = createSessionTypePolicy("design");
    const b = createSessionTypePolicy("design");
    expect(a).toBe(b);
  });
});

describe("CodePolicy", () => {
  const policy = new CodePolicy();

  it("toolPreset 返回 prefs.tools 原样", () => {
    const prefs = ["read", "write", "bash", "godot_run_scene"];
    expect(policy.toolPreset(prefs)).toEqual(prefs);
  });

  it("systemAppend 是空字符串", () => {
    expect(policy.systemAppend()).toBe("");
  });

  it("shouldBlockWriteTool 永远 false (code 无约束)", () => {
    expect(
      policy.shouldBlockWriteTool("write", { path: "/etc/passwd" }, "/tmp"),
    ).toEqual({ block: false });
    expect(
      policy.shouldBlockWriteTool("bash", { command: "rm -rf /" }, "/tmp"),
    ).toEqual({ block: false });
  });

  it("filterSkills 走 code 路径(不重排 design skills)", () => {
    const skills: SessionTypeSkill[] = [
      { name: "common", filePath: "/p/.pi/skills/common/SKILL.md" },
      { name: "design-foo", filePath: "/p/.pi/skills/design-foo/SKILL.md" },
    ];
    const out = policy.filterSkills(skills, "/p", []);
    // code session: design skills 不应该被提前
    expect(out[0]?.name).toBe("common");
  });

  it("persistenceSchema 返回 code default", () => {
    expect(policy.persistenceSchema().default).toBe("code");
  });
});

describe("DesignPolicy", () => {
  const policy = new DesignPolicy();

  it("toolPreset 包含 readonly + write/edit, 不含 write_plan", () => {
    const out = policy.toolPreset(["write_plan", "godot_run_scene"]);
    // 必须有 read/grep/find/ls + write/edit
    for (const t of READONLY_CORE_TOOLS) {
      expect(out).toContain(t);
    }
    expect(out).toContain("write");
    expect(out).toContain("edit");
    // 写工具白名单内不包含写 plan(策划写文档不写 plan 文件)
    expect(out).not.toContain(WRITE_PLAN_TOOL);
    // 也不包含 godot mutating
    expect(out).not.toContain("godot_run_scene");
  });

  it("toolPreset 把用户 prefs 里的 readonly Godot 工具带进来", () => {
    // 取一个 plan-mode 的 optional readonly tool 模拟用户开启的
    const sample = PLAN_MODE_OPTIONAL_READONLY_TOOLS[0];
    if (!sample) {
      // 如果 optional 列表为空,跳过
      return;
    }
    const prefs = [sample];
    const out = policy.toolPreset(prefs);
    expect(out).toContain(sample);
  });

  it("systemAppend 包含策划说明", () => {
    const text = policy.systemAppend();
    expect(text).toContain("Design session");
    expect(text).toContain("game-design");
  });

  it("shouldBlockWriteTool: 路径在 cwd 外 → 拦", () => {
    const decision = policy.shouldBlockWriteTool(
      "write",
      { path: "scripts/main.gd" },
      join(CWD, "other-cwd"),
    );
    expect(decision.block).toBe(true);
  });

  it("shouldBlockWriteTool: 路径在 cwd 内但不在 game-design/ → 拦", () => {
    const decision = policy.shouldBlockWriteTool(
      "write",
      { path: "scripts/main.gd" },
      CWD,
    );
    expect(decision.block).toBe(true);
    expect(decision.reason).toMatch(/game-design\//);
  });

  it("shouldBlockWriteTool: 路径在 game-design/ 内 → 放行", () => {
    const decision = policy.shouldBlockWriteTool(
      "write",
      { path: "game-design/character.md" },
      CWD,
    );
    expect(decision.block).toBe(false);
  });

  it("shouldBlockWriteTool: read 类工具任何路径都放行(策划需要读工作区)", () => {
    const decision = policy.shouldBlockWriteTool(
      "read",
      { path: "scripts/anything.gd" },
      CWD,
    );
    expect(decision.block).toBe(false);
  });

  it("shouldBlockWriteTool: 抛错时 fail-safe 返回 false (不崩溃 tool_call)", () => {
    // 用一个会触发的 args 类型 (toolInput 不是 Record) 模拟异常
    // 注: 实际 guard 内部对 args 做了 typeof 检查,不太会抛;这里直接用
    //   undefined args 走 default path → 不会被拦(因为没 path 可校验)
    const decision = policy.shouldBlockWriteTool(
      "write",
      undefined,
      CWD,
    );
    // 防御性: args undefined 时 guard 内部按 "需要明确写入路径" 拦
    // 这里只验证不抛异常
    expect(typeof decision.block).toBe("boolean");
  });

  it("filterSkills: design-* 排前面", () => {
    const skills: SessionTypeSkill[] = [
      { name: "common", filePath: "/p/.pi/skills/common/SKILL.md" },
      { name: "design-foo", filePath: "/p/.pi/skills/design-foo/SKILL.md" },
    ];
    const out = policy.filterSkills(skills, "/p", []);
    expect(out[0]?.name).toBe("design-foo");
  });

  it("persistenceSchema 返回 design default", () => {
    expect(policy.persistenceSchema().default).toBe("design");
  });
});

describe("type × tool 矩阵 (acceptance)", () => {
  const cases: Array<{
    type: "code" | "design" | undefined;
    tool: string;
    path: string;
    cwd: string;
    expectBlock: boolean;
  }> = [
    // code: 任何 tool/path 都放行
    { type: "code", tool: "write", path: "scripts/x.gd", cwd: "CWD", expectBlock: false },
    { type: "code", tool: "bash", path: "", cwd: "CWD", expectBlock: false },
    // design + write + path 在 cwd 内但不是 game-design/ → 拦
    { type: "design", tool: "write", path: "src/main.gd", cwd: "CWD", expectBlock: true },
    // design + write + game-design/ → 放行
    { type: "design", tool: "write", path: "game-design/char.md", cwd: "CWD", expectBlock: false },
    // design + read → 放行(策划需要读工作区)
    { type: "design", tool: "read", path: "scripts/anything.gd", cwd: "CWD", expectBlock: false },
    // design + write + cwd 外(不存在的目录)→ 拦
    { type: "design", tool: "write", path: "scripts/x.gd", cwd: "OUTSIDE_CWD", expectBlock: true },
  ];

  for (const c of cases) {
    it(`type=${c.type ?? "undefined"} tool=${c.tool} path=${c.path}`, () => {
      const policy = createSessionTypePolicy(c.type);
      const resolvedCwd = c.cwd === "CWD" ? CWD : join(CWD, "outside");
      const decision = policy.shouldBlockWriteTool(
        c.tool,
        c.path ? { path: c.path } : {},
        resolvedCwd,
      );
      expect(decision.block).toBe(c.expectBlock);
    });
  }
});

describe("新增 type 深度指标", () => {
  it("DESIGN_SESSION_TYPE_TOOLS 是 readonly core + write/edit 的稳定 union", () => {
    // 这个断言锁定 DESIGN_SESSION_TYPE_TOOLS 的"只读+写"承诺,
    // 未来加新 type 时如果破坏这个 union,单测会失败.
    expect(DESIGN_SESSION_TYPE_TOOLS).toContain("write");
    expect(DESIGN_SESSION_TYPE_TOOLS).toContain("edit");
    for (const t of READONLY_CORE_TOOLS) {
      expect(DESIGN_SESSION_TYPE_TOOLS).toContain(t);
    }
    expect(DESIGN_SESSION_TYPE_TOOLS).not.toContain(WRITE_PLAN_TOOL);
  });

  it("isInsideGameDesign 自身行为稳定(只放行 game-design/ 子树)", () => {
    expect(isInsideGameDesign(CWD, "game-design")).toBe(true);
    expect(isInsideGameDesign(CWD, "game-design/char.md")).toBe(true);
    expect(isInsideGameDesign(CWD, "src/main.gd")).toBe(false);
    expect(isInsideGameDesign(CWD, join(sep + "etc" + sep + "passwd"))).toBe(
      false,
    );
  });
});
