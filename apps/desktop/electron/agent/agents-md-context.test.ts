/**
 * Vitest 单元测试 — `agents-md-context`.
 *
 * 覆盖：
 *  1. 候选顺序：AGENT.md > AGENT.MD > agent.md > agent.MD（POSIX only；Windows
 *     case-insensitive FS 不允许同目录两个大小写变体共存）
 *  2. 与 base 已有的 AGENTS.md 同目录不重复追加（目录级去重）
 *  3. ancestor walk 顺序：与 Pi 一致 —— global agentDir 在前，ancestors 按
 *     「parent → child」排列（child 在数组末尾，system prompt 中也在末尾）
 *  4. global agentDir 命中出现在结果最前
 *  5. 不存在 / 不可读文件 → 跳过，函数不抛
 *  6. case-insensitive (win32)：同路径大小写不同时不重复
 *  7. augmentAgentsFiles 合并顺序与去重
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SINGLE_CANDIDATES,
  augmentAgentsFiles,
  loadAgentsMdFiles,
} from "./agents-md-context";

function makeTree(): string {
  return mkdtempSync(join(tmpdir(), "x-agent-md-ctx-"));
}

describe("SINGLE_CANDIDATES", () => {
  it("按 AGENT.md > AGENT.MD > agent.md > agent.MD 排列", () => {
    expect(SINGLE_CANDIDATES).toEqual([
      "AGENT.md",
      "AGENT.MD",
      "agent.md",
      "agent.MD",
    ]);
  });
});

describe("loadAgentsMdFiles", () => {
  let root: string;

  beforeEach(() => {
    root = makeTree();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("无任何文件时返回空数组", () => {
    const out = loadAgentsMdFiles(root, join(root, "agentdir"));
    expect(out).toEqual([]);
  });

  it("仅 cwd 命中: 出现在结果", () => {
    writeFileSync(join(root, "AGENT.md"), "cwd-only", "utf8");
    const agentDir = join(root, "agentdir");
    mkdirSync(agentDir, { recursive: true });
    const out = loadAgentsMdFiles(root, agentDir);
    expect(out.length).toBe(1);
    expect(out[0]?.content).toBe("cwd-only");
    expect(out[0]?.path).toBe(join(root, "AGENT.md"));
  });

  it("global agentDir 命中出现在最前", () => {
    const agentDir = join(root, "agentdir");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "AGENT.md"), "global", "utf8");
    writeFileSync(join(root, "AGENT.md"), "cwd", "utf8");
    const out = loadAgentsMdFiles(root, agentDir);
    expect(out.length).toBe(2);
    expect(out[0]?.content).toBe("global");
    expect(out[1]?.content).toBe("cwd");
  });

  it("ancestor walk 顺序: 父先于子（与 Pi loadProjectContextFiles 一致）", () => {
    const agentDir = join(root, "agentdir");
    mkdirSync(agentDir, { recursive: true });
    const sub = join(root, "sub");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "AGENT.md"), "child", "utf8");
    writeFileSync(join(root, "AGENT.md"), "parent", "utf8");
    const out = loadAgentsMdFiles(sub, agentDir);
    // Pi 的实现用 unshift 累积 ancestorHits, 最终顺序是 [parent, child]
    // 数组顺序就是 system prompt 出现顺序: parent 先, child 后
    expect(out.map((f) => f.content)).toEqual(["parent", "child"]);
  });

  it("候选顺序: 同目录 AGENT.md > agent.md (POSIX only)", () => {
    // Windows 文件系统 case-insensitive, 同目录无法创建 AGENT.md + agent.md 两个文件
    if (process.platform === "win32") {
      // 改成断言"AGENT.md 始终被优先尝试"——通过 SINGLE_CANDIDATES 顺序间接保证
      expect(SINGLE_CANDIDATES.indexOf("AGENT.md")).toBeLessThan(
        SINGLE_CANDIDATES.indexOf("agent.md"),
      );
      return;
    }
    writeFileSync(join(root, "AGENT.md"), "UPPER", "utf8");
    writeFileSync(join(root, "agent.md"), "lower", "utf8");
    const out = loadAgentsMdFiles(root, join(root, "agentdir"));
    expect(out.length).toBe(1);
    expect(out[0]?.content).toBe("UPPER");
  });

  it("不存在文件不抛错, 返回空", () => {
    const out = loadAgentsMdFiles(root, join(root, "agentdir"));
    expect(Array.isArray(out)).toBe(true);
  });

  it("可读文件, 完整保留多行 UTF-8 内容", () => {
    const multiline = "line1\nline2\n中文也行\n### 标题\n";
    writeFileSync(join(root, "AGENT.md"), multiline, "utf8");
    const out = loadAgentsMdFiles(root, join(root, "agentdir"));
    expect(out.length).toBe(1);
    expect(out[0]?.content).toBe(multiline);
  });
});

describe("augmentAgentsFiles", () => {
  let root: string;

  beforeEach(() => {
    root = makeTree();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("base 为空 + extra 为空 → 空", () => {
    const out = augmentAgentsFiles(
      { agentsFiles: [] },
      { cwd: root, agentDir: join(root, "agentdir") },
    );
    expect(out.agentsFiles).toEqual([]);
  });

  it("目录级去重: base 有 AGENTS.md + cwd 有 AGENT.md → 不重复追加", () => {
    // base 里 Pi 已经发现 cwd/AGENTS.md
    const basePath = join(root, "AGENTS.md");
    const base = {
      agentsFiles: [{ path: basePath, content: "FROM PI" }],
    };
    // cwd 也有同目录 AGENT.md（不同文件，但同目录）
    writeFileSync(join(root, "AGENT.md"), "FROM US", "utf8");
    const out = augmentAgentsFiles(base, {
      cwd: root,
      agentDir: join(root, "agentdir"),
    });
    expect(out.agentsFiles.length).toBe(1);
    expect(out.agentsFiles[0]?.content).toBe("FROM PI");
  });

  it("跨目录保留: base 在父目录, extra 在子目录 → 都保留", () => {
    const sub = join(root, "sub");
    mkdirSync(sub, { recursive: true });
    // Pi found AGENTS.md at the parent (root) level
    const base = {
      agentsFiles: [{ path: join(root, "AGENTS.md"), content: "parent" }],
    };
    // We find AGENT.md at the child level
    writeFileSync(join(sub, "AGENT.md"), "child", "utf8");
    const out = augmentAgentsFiles(base, {
      cwd: sub,
      agentDir: join(root, "agentdir"),
    });
    expect(out.agentsFiles.map((f) => f.path)).toEqual([
      join(root, "AGENTS.md"),
      join(sub, "AGENT.md"),
    ]);
  });

  it("合并顺序: base 在前, extra 按 Pi 顺序追加 (global 先, 父先于子)", () => {
    const agentDir = join(root, "agentdir");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "AGENT.md"), "global", "utf8");
    const sub = join(root, "sub", "deep");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "AGENT.md"), "deep", "utf8");
    writeFileSync(join(root, "AGENT.md"), "root", "utf8");
    const out = augmentAgentsFiles(
      { agentsFiles: [] },
      { cwd: sub, agentDir },
    );
    // loadAgentsMdFiles 内部: global -> [parent, child] (即 [root, deep])
    expect(out.agentsFiles.map((f) => f.content)).toEqual([
      "global",
      "root",
      "deep",
    ]);
  });

  it("case-insensitive (win32): 同路径大小写不同时不重复", () => {
    const realPath = join(root, "AGENT.md");
    writeFileSync(realPath, "data", "utf8");
    const base = {
      agentsFiles: [{ path: realPath, content: "from base" }],
    };
    const out = augmentAgentsFiles(base, {
      cwd: root,
      agentDir: join(root, "agentdir"),
    });
    if (process.platform === "win32") {
      // win32 case-insensitive: 同目录视为同一路径, 跳过 extra
      expect(out.agentsFiles.length).toBe(1);
      expect(out.agentsFiles[0]?.content).toBe("from base");
    } else {
      // POSIX: 不同文件名视为不同文件
      expect(out.agentsFiles.length).toBe(2);
    }
  });

  it("base 含多个文件 → 全部保留在结果中, extra 追加到末尾", () => {
    // base: 两个 AGENTS.md, 分别在 root 和 root/sub
    // extra: 单数变体在 cwd=root/other, 走 walker 时是 cwd 自身
    const sub = join(root, "sub");
    mkdirSync(sub, { recursive: true });
    const other = join(root, "other");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "AGENT.md"), "other-AGENT", "utf8");
    const base = {
      agentsFiles: [
        { path: join(root, "AGENTS.md"), content: "AGENTS" },
        { path: join(sub, "AGENTS.md"), content: "sub-AGENTS" },
      ],
    };
    const out = augmentAgentsFiles(base, {
      cwd: other,
      agentDir: join(root, "agentdir"),
    });
    // base 保留, extra 追加: other 是 cwd 自身, walker 第一站命中
    expect(out.agentsFiles.map((f) => f.content)).toEqual([
      "AGENTS",
      "sub-AGENTS",
      "other-AGENT",
    ]);
  });
});

describe("loadAgentsMdFiles 错误容错", () => {
  it("cwd 是文件时不抛 (dirname 走到根)", () => {
    const root = mkdtempSync(join(tmpdir(), "x-agent-md-ctx-"));
    try {
      const file = join(root, "i-am-a-file");
      writeFileSync(file, "x", "utf8");
      // cwd 指向文件: 走 dirname 直到根, 不抛
      const out = loadAgentsMdFiles(file, join(root, "agentdir"));
      expect(Array.isArray(out)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("正常调用不抛", () => {
    const root = mkdtempSync(join(tmpdir(), "x-agent-md-ctx-"));
    try {
      const out = loadAgentsMdFiles(root, join(root, "agentdir"));
      expect(Array.isArray(out)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
