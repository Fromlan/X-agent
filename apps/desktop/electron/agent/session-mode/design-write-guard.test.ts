/**
 * Vitest 单元测试 — design-write-guard.
 * 与离线脚本并行；CI 覆盖率门槛依赖这些用例.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  DESIGN_DIR_NAME,
  _internals,
  createDesignWriteGuardExtension,
  isInsideGameDesign,
  shouldBlockDesignSessionWrite,
} from "./design-write-guard";

// 使用真实临时目录, 因为 cwd-sandbox 内部会 existsSync(cwd) 校验.
// 这样测试在 Windows / Linux / macOS 都跑得通, 避免 OS 路径分隔符差异.
let CWD: string;

beforeAll(() => {
  CWD = mkdtempSync(join(tmpdir(), "x-agent-design-guard-"));
  mkdirSync(join(CWD, DESIGN_DIR_NAME, "systems"), { recursive: true });
  mkdirSync(join(CWD, "scripts"), { recursive: true });
  writeFileSync(join(CWD, "project.godot"), "", "utf8");
  writeFileSync(join(CWD, DESIGN_DIR_NAME, "character.md"), "hi", "utf8");
  writeFileSync(join(CWD, DESIGN_DIR_NAME, "systems", "combat.md"), "x", "utf8");
  writeFileSync(join(CWD, "scripts", "player.gd"), "x", "utf8");
});

afterAll(() => {
  rmSync(CWD, { recursive: true, force: true });
});

describe("isInsideGameDesign", () => {
  it("cwd-relative 路径在 game-design/ 子树下: true", () => {
    expect(isInsideGameDesign(CWD, "game-design/character.md")).toBe(true);
    expect(isInsideGameDesign(CWD, "game-design/systems/combat.md")).toBe(
      true,
    );
  });

  it("绝对路径在 game-design/ 子树下: true", () => {
    expect(
      isInsideGameDesign(CWD, join(CWD, DESIGN_DIR_NAME, "x.md")),
    ).toBe(true);
  });

  it("game-design 自身: true", () => {
    expect(isInsideGameDesign(CWD, "game-design")).toBe(true);
  });

  it("Windows 大小写不敏感", () => {
    expect(isInsideGameDesign(CWD, "Game-Design/CHAR.md")).toBe(true);
    expect(isInsideGameDesign(CWD, "GAME-DESIGN/lower.md")).toBe(true);
  });

  it("项目根下其他目录: false", () => {
    expect(isInsideGameDesign(CWD, "scripts/player.gd")).toBe(false);
    expect(isInsideGameDesign(CWD, "project.godot")).toBe(false);
    expect(isInsideGameDesign(CWD, ".")).toBe(false);
    expect(isInsideGameDesign(CWD, "")).toBe(false);
  });

  it("game-design 前缀相似但不同的目录: false", () => {
    expect(isInsideGameDesign(CWD, "game-designx/foo.md")).toBe(false);
    expect(isInsideGameDesign(CWD, "game-design-evil/foo.md")).toBe(false);
  });

  it("尝试逃逸 cwd: false (cwd-sandbox 兜底)", () => {
    // resolveInsideCwd 会拒绝 ../ 上层, 这里 isInsideGameDesign 看到
    // 的也是已 resolve 后的路径, 不会落入 game-design
    expect(isInsideGameDesign(CWD, "../../../game-design/foo.md")).toBe(
      false,
    );
  });

  it("空 cwd: false", () => {
    expect(isInsideGameDesign("", "game-design/foo.md")).toBe(false);
  });
});

describe("shouldBlockDesignSessionWrite — 非 design session 不激活", () => {
  it("code session + write 任意路径: 不 block", () => {
    expect(
      shouldBlockDesignSessionWrite("code", "write", { path: "scripts/x.gd" }, CWD),
    ).toEqual({ block: false });
  });

  it("code session + bash 写命令: 不 block (设计 guard 不管)", () => {
    expect(
      shouldBlockDesignSessionWrite(
        "code",
        "bash",
        { command: "rm foo.txt" },
        CWD,
      ),
    ).toEqual({ block: false });
  });
});

describe("shouldBlockDesignSessionWrite — design session 读工具全部放行", () => {
  it("read 任何路径: 不 block", () => {
    expect(
      shouldBlockDesignSessionWrite("design", "read", { path: "scripts/x.gd" }, CWD),
    ).toEqual({ block: false });
    expect(
      shouldBlockDesignSessionWrite(
        "design",
        "read",
        { path: join(CWD, "scripts", "player.gd") },
        CWD,
      ),
    ).toEqual({ block: false });
  });

  it("grep / find / ls: 不 block", () => {
    expect(
      shouldBlockDesignSessionWrite("design", "grep", { path: "." }, CWD),
    ).toEqual({ block: false });
    expect(
      shouldBlockDesignSessionWrite("design", "find", { path: "." }, CWD),
    ).toEqual({ block: false });
    expect(
      shouldBlockDesignSessionWrite("design", "ls", { path: "." }, CWD),
    ).toEqual({ block: false });
  });

  it("godot 只读内省工具: 不 block", () => {
    expect(
      shouldBlockDesignSessionWrite(
        "design",
        "godot_get_scene_tree",
        { path: "scenes/main.tscn" },
        CWD,
      ),
    ).toEqual({ block: false });
    expect(
      shouldBlockDesignSessionWrite(
        "design",
        "godot_lint_scripts",
        { path: "scripts" },
        CWD,
      ),
    ).toEqual({ block: false });
  });
});

describe("shouldBlockDesignSessionWrite — design session 写工具 path 约束", () => {
  it("write 到 game-design/ 子树: 不 block", () => {
    expect(
      shouldBlockDesignSessionWrite(
        "design",
        "write",
        { path: "game-design/character.md" },
        CWD,
      ),
    ).toEqual({ block: false });
    expect(
      shouldBlockDesignSessionWrite(
        "design",
        "write",
        {
          path: join(CWD, "game-design", "systems", "combat.md"),
        },
        CWD,
      ),
    ).toEqual({ block: false });
  });

  it("write 到 game-design/ 外: block", () => {
    const r = shouldBlockDesignSessionWrite(
      "design",
      "write",
      { path: "scripts/player.gd" },
      CWD,
    );
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/game-design\//);
  });

  it("edit 到 game-design/ 外: block", () => {
    const r = shouldBlockDesignSessionWrite(
      "design",
      "edit",
      { path: "project.godot" },
      CWD,
    );
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/game-design\//);
  });

  it("write 含 .. 逃逸: block (cwd-sandbox 兜底)", () => {
    const r = shouldBlockDesignSessionWrite(
      "design",
      "write",
      { path: "../game-design/foo.md" },
      CWD,
    );
    expect(r.block).toBe(true);
  });

  it("write 无 path 参数: block", () => {
    const r = shouldBlockDesignSessionWrite(
      "design",
      "write",
      {},
      CWD,
    );
    expect(r.block).toBe(true);
  });

  it("write path 非字符串: block", () => {
    const r = shouldBlockDesignSessionWrite(
      "design",
      "write",
      { path: 123 },
      CWD,
    );
    expect(r.block).toBe(true);
  });

  it("write 路径前缀相似 (game-designx): block", () => {
    const r = shouldBlockDesignSessionWrite(
      "design",
      "write",
      { path: "game-designx/foo.md" },
      CWD,
    );
    expect(r.block).toBe(true);
  });
});

describe("shouldBlockDesignSessionWrite — design session bash 约束", () => {
  it("readonly bash 在 cwd 内: 不 block", () => {
    expect(
      shouldBlockDesignSessionWrite(
        "design",
        "bash",
        { command: "ls game-design" },
        CWD,
      ),
    ).toEqual({ block: false });
    expect(
      shouldBlockDesignSessionWrite(
        "design",
        "bash",
        { command: "cat game-design/character.md" },
        CWD,
      ),
    ).toEqual({ block: false });
  });

  it("写命令: block", () => {
    const r = shouldBlockDesignSessionWrite(
      "design",
      "bash",
      { command: "rm foo.txt" },
      CWD,
    );
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/策划会话/);
  });

  it("试图 escape cwd: block", () => {
    const r = shouldBlockDesignSessionWrite(
      "design",
      "bash",
      { command: "cd .. && ls" },
      CWD,
    );
    expect(r.block).toBe(true);
  });
});

describe("shouldBlockDesignSessionWrite — design session 特殊工具", () => {
  it("write_plan: block (策划会话禁用)", () => {
    const r = shouldBlockDesignSessionWrite(
      "design",
      "write_plan",
      { title: "x", markdown: "y" },
      CWD,
    );
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/write_plan/);
  });

  it("godot_set_project_setting: block", () => {
    const r = shouldBlockDesignSessionWrite(
      "design",
      "godot_set_project_setting",
      { key: "application/run/main_scene" },
      CWD,
    );
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/godot_set_project_setting/);
  });

  it("未在 PATH_ARG 注册的写工具: block", () => {
    const r = shouldBlockDesignSessionWrite(
      "design",
      "unknown_mutation_tool",
      { path: "game-design/x.md" },
      CWD,
    );
    expect(r.block).toBe(true);
  });
});

describe("shouldBlockDesignSessionWrite — 设计会话内 cwd null", () => {
  it("design + cwd null: 全部放行 (fallback 信任 caller)", () => {
    expect(
      shouldBlockDesignSessionWrite("design", "write", { path: "x.md" }, null),
    ).toEqual({ block: false });
  });
});

describe("createDesignWriteGuardExtension", () => {
  it("返回 InlineExtension (function)", () => {
    const ext = createDesignWriteGuardExtension({
      getSessionType: () => "design",
      getCwd: () => CWD,
    });
    expect(typeof ext).toBe("function");
  });

  it("Pi on(\"tool_call\") hook 在 design + write 越界时 block", () => {
    const ext = createDesignWriteGuardExtension({
      getSessionType: () => "design",
      getCwd: () => CWD,
    });
    let captured: ((event: unknown) => Promise<unknown>) | null = null;
    const pi = {
      on(name: string, cb: (event: unknown) => Promise<unknown>) {
        if (name === "tool_call") captured = cb;
      },
    };
    ext(pi as never);
    expect(captured).not.toBeNull();
    return captured!({
      toolName: "write",
      input: { path: "scripts/player.gd" },
    }).then((decision: unknown) => {
      expect(decision).toEqual({
        block: true,
        reason: expect.stringMatching(/game-design/),
      });
    });
  });

  it("Pi on(\"tool_call\") hook 在 code session 时不 block", () => {
    const ext = createDesignWriteGuardExtension({
      getSessionType: () => "code",
      getCwd: () => CWD,
    });
    let captured: ((event: unknown) => Promise<unknown>) | null = null;
    const pi = {
      on(name: string, cb: (event: unknown) => Promise<unknown>) {
        if (name === "tool_call") captured = cb;
      },
    };
    ext(pi as never);
    expect(captured).not.toBeNull();
    return captured!({
      toolName: "write",
      input: { path: "scripts/player.gd" },
    }).then((decision: unknown) => {
      expect(decision).toBeUndefined();
    });
  });
});

describe("_internals 路径归一化", () => {
  it("@ 前缀去除", () => {
    expect(_internals.normalizeToolPath("@scripts/x.gd")).toBe("scripts/x.gd");
  });

  it("~/ 展开为 home", () => {
    if (process.platform === "win32") {
      expect(_internals.normalizeToolPath("~/foo")).toMatch(/foo$/);
    } else {
      expect(_internals.normalizeToolPath("~/foo")).toBe(
        join(require("node:os").homedir(), "foo"),
      );
    }
  });

  it("file:// URL 转绝对路径", () => {
    const expected = resolve("foo/bar.md");
    const url =
      "file://" +
      (process.platform === "win32" ? "/" : "") +
      expected.replace(/\\/g, "/");
    expect(_internals.normalizeToolPath(url)).toBe(expected);
  });
});

describe("DESIGN_DIR_NAME 契约", () => {
  it("目录名为 game-design, 不可改", () => {
    expect(DESIGN_DIR_NAME).toBe("game-design");
  });
});
