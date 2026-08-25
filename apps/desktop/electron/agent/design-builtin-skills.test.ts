/**
 * Vitest 单元测试 — design builtin skills 5 条契约 + 懒写幂等性.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, posix } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BUILTIN_DESIGN_SKILL_IDS,
  DESIGN_BUILTIN_SKILLS,
  defaultAgentDirPath,
  ensureBuiltinDesignSkillsInstalled,
  formatSkillMdContent,
  getBuiltinSkillFilePath,
  getBuiltinSkillsInstallDir,
  getInstallRecordPath,
} from "./design-builtin-skills";

describe("DESIGN_BUILTIN_SKILLS 契约", () => {
  it("包含 5 条, id 唯一", () => {
    expect(DESIGN_BUILTIN_SKILLS.length).toBe(5);
    const ids = DESIGN_BUILTIN_SKILLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(5);
  });

  it("BUILTIN_DESIGN_SKILL_IDS 与 DESIGN_BUILTIN_SKILLS 顺序一致", () => {
    expect(BUILTIN_DESIGN_SKILL_IDS).toEqual(DESIGN_BUILTIN_SKILLS.map((s) => s.id));
  });

  it("5 条 id 全部以 design- 前缀, 符合 prioritizeDesignSkills 匹配", () => {
    for (const id of BUILTIN_DESIGN_SKILL_IDS) {
      expect(id.startsWith("design-")).toBe(true);
    }
  });

  it("每条 description 1..240 字符 (Pi 校验 1024 headroom)", () => {
    for (const s of DESIGN_BUILTIN_SKILLS) {
      expect(s.description.length, `${s.id} description 长度`).toBeGreaterThanOrEqual(1);
      expect(s.description.length, `${s.id} description 长度`).toBeLessThanOrEqual(240);
    }
  });

  it("每条 body 200..2400 字符 (单 skill 不超 token 预算)", () => {
    for (const s of DESIGN_BUILTIN_SKILLS) {
      expect(s.body.length, `${s.id} body 长度`).toBeGreaterThanOrEqual(200);
      expect(s.body.length, `${s.id} body 长度`).toBeLessThanOrEqual(2400);
    }
  });

  it("5 条 body 总长 ≤ 12KB (预留安全边际, 实际不读入 system prompt)", () => {
    const total = DESIGN_BUILTIN_SKILLS.reduce((sum, s) => sum + s.body.length, 0);
    expect(total).toBeLessThan(12_000);
  });
});

describe("formatSkillMdContent", () => {
  it("输出含 frontmatter 头 + 名称 + description + body", () => {
    const skill = DESIGN_BUILTIN_SKILLS[0];
    const out = formatSkillMdContent(skill);
    expect(out.startsWith("---\n")).toBe(true);
    expect(out).toContain(`name: ${skill.name}`);
    expect(out).toContain(`description: ${JSON.stringify(skill.description)}`);
    expect(out).toContain("---");
    expect(out).toContain(skill.body.trimEnd());
  });

  it("description 含双引号 (JSON.stringify 包裹) — Pi frontmatter 友好", () => {
    const out = formatSkillMdContent(DESIGN_BUILTIN_SKILLS[0]);
    expect(out).toMatch(/description: "[^"]+"/);
  });
});

describe("路径解析", () => {
  it("getBuiltinSkillsInstallDir 拼出 <agentDir>/skills/", () => {
    // 用 posix.join 显式构造 (Windows 的 join 会把 /tmp/x 当作 x: 盘符)
    expect(getBuiltinSkillsInstallDir("/tmp/x")).toBe(posix.join("/tmp/x", "skills"));
  });

  it("getBuiltinSkillFilePath 拼出 <agentDir>/skills/<id>/SKILL.md", () => {
    expect(getBuiltinSkillFilePath("design-initiation", "/tmp/x")).toBe(
      posix.join("/tmp/x", "skills", "design-initiation", "SKILL.md"),
    );
  });

  it("getInstallRecordPath 拼出 <agentDir>/x-agent/builtin-skills-installed.json", () => {
    expect(getInstallRecordPath("/tmp/x")).toBe(
      posix.join("/tmp/x", "x-agent", "builtin-skills-installed.json"),
    );
  });

  it("defaultAgentDirPath 包含 .pi/agent (用户态 XDG)", () => {
    expect(defaultAgentDirPath()).toMatch(/[/\\]\.pi[/\\]agent$/);
  });
});

describe("ensureBuiltinDesignSkillsInstalled (懒写 + 幂等)", () => {
  let tmpAgentDir: string;

  beforeEach(() => {
    tmpAgentDir = mkdtempSync(join(tmpdir(), "x-agent-design-skills-"));
  });

  afterEach(() => {
    rmSync(tmpAgentDir, { recursive: true, force: true });
  });

  it("首次 install: 5 个 SKILL.md 全部出现", () => {
    const result = ensureBuiltinDesignSkillsInstalled({ agentDirPath: tmpAgentDir });
    expect(result.written).toBe(5);
    expect(result.skipped).toBe(0);
    expect(result.failed).toEqual([]);
    for (const id of BUILTIN_DESIGN_SKILL_IDS) {
      const p = getBuiltinSkillFilePath(id, tmpAgentDir);
      const text = readFileSync(p, "utf8");
      expect(text).toMatch(/^---\nname: design-/);
      expect(text).toMatch(/^---$/m);
    }
  });

  it("二次 install: 0 字节写 (sha256 一致)", () => {
    ensureBuiltinDesignSkillsInstalled({ agentDirPath: tmpAgentDir });
    const result = ensureBuiltinDesignSkillsInstalled({ agentDirPath: tmpAgentDir });
    expect(result.written).toBe(0);
    expect(result.skipped).toBe(5);
  });

  it("用户删 1 个 → 补回, 其他不动", () => {
    ensureBuiltinDesignSkillsInstalled({ agentDirPath: tmpAgentDir });
    rmSync(getBuiltinSkillFilePath("design-process", tmpAgentDir), { force: true });
    const result = ensureBuiltinDesignSkillsInstalled({ agentDirPath: tmpAgentDir });
    expect(result.written).toBe(1);
    expect(result.skipped).toBe(4);
    // 补回文件存在
    expect(
      readFileSync(getBuiltinSkillFilePath("design-process", tmpAgentDir), "utf8"),
    ).toContain("name: design-process");
  });

  it("用户改 1 个内容 → 默认不覆盖 (用户内容保留)", () => {
    ensureBuiltinDesignSkillsInstalled({ agentDirPath: tmpAgentDir });
    const target = getBuiltinSkillFilePath("design-initiation", tmpAgentDir);
    const original = readFileSync(target, "utf8");
    // 用户加 1 行自定义内容
    const modified = original + "\n<!-- USER CUSTOMIZED -->\n";
    writeFileSync(target, modified, "utf8");
    const result = ensureBuiltinDesignSkillsInstalled({ agentDirPath: tmpAgentDir });
    expect(result.written).toBe(0);
    expect(result.skipped).toBe(5);
    // 用户内容仍在
    expect(readFileSync(target, "utf8")).toContain("USER CUSTOMIZED");
  });

  it("force: true 覆盖用户内容", () => {
    ensureBuiltinDesignSkillsInstalled({ agentDirPath: tmpAgentDir });
    const target = getBuiltinSkillFilePath("design-systems", tmpAgentDir);
    const original = readFileSync(target, "utf8");
    writeFileSync(target, original + "\n<!-- USER CUSTOMIZED -->\n", "utf8");
    const result = ensureBuiltinDesignSkillsInstalled({
      agentDirPath: tmpAgentDir,
      force: true,
    });
    expect(result.written).toBe(5);
    expect(readFileSync(target, "utf8")).not.toContain("USER CUSTOMIZED");
  });

  it("首次 install 后写记录文件 builtin-skills-installed.json", () => {
    ensureBuiltinDesignSkillsInstalled({ agentDirPath: tmpAgentDir });
    const record = JSON.parse(
      readFileSync(getInstallRecordPath(tmpAgentDir), "utf8"),
    ) as { installedAt: string; sha256: Record<string, string> };
    expect(typeof record.installedAt).toBe("string");
    expect(Object.keys(record.sha256).sort()).toEqual([...BUILTIN_DESIGN_SKILL_IDS].sort());
  });

  it("记录文件损坏时回退到全量 install", () => {
    ensureBuiltinDesignSkillsInstalled({ agentDirPath: tmpAgentDir });
    // 损坏记录
    writeFileSync(getInstallRecordPath(tmpAgentDir), "{not json", "utf8");
    const result = ensureBuiltinDesignSkillsInstalled({ agentDirPath: tmpAgentDir });
    // 记录损坏 = 当作\"用户改过全部\", 默认跳过; 想覆盖用 force
    expect(result.written).toBe(0);
    expect(result.skipped).toBe(5);
  });
});
