/**
 * Vitest 单元测试 — builtin-skills-installer 进程内缓存 + 串行化并发.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureBuiltinDesignSkillsInstalledSafe,
  ensureBuiltinDesignSkillsInstalledSync,
  resetBuiltinSkillsInstallerCacheForTests,
} from "./builtin-skills-installer";
import { getBuiltinSkillFilePath } from "./design-builtin-skills";
import { BUILTIN_DESIGN_SKILL_IDS } from "./design-builtin-skills";

describe("builtin-skills-installer", () => {
  let tmpAgentDir: string;

  beforeEach(() => {
    tmpAgentDir = mkdtempSync(join(tmpdir(), "x-agent-installer-"));
    resetBuiltinSkillsInstallerCacheForTests();
  });

  afterEach(() => {
    rmSync(tmpAgentDir, { recursive: true, force: true });
    resetBuiltinSkillsInstallerCacheForTests();
  });

  it("sync 入口: 5 个 SKILL.md 出现", () => {
    const result = ensureBuiltinDesignSkillsInstalledSync({
      agentDirPath: tmpAgentDir,
    });
    expect(result.written).toBe(5);
    for (const id of BUILTIN_DESIGN_SKILL_IDS) {
      expect(
        readFileSync(getBuiltinSkillFilePath(id, tmpAgentDir), "utf8"),
      ).toContain(`name: ${id}`);
    }
  });

  it("async 入口: 首次 install 写 5 个, 二次 (缓存) 不重写磁盘", async () => {
    const r1 = await ensureBuiltinDesignSkillsInstalledSafe({
      agentDirPath: tmpAgentDir,
    });
    expect(r1.written).toBe(5);
    // 记下 mtime
    const mtimeBefore = statSync(
      getBuiltinSkillFilePath("design-initiation", tmpAgentDir),
    ).mtimeMs;
    // 睡 20ms 确保如果重写 mtime 会变
    await new Promise((r) => setTimeout(r, 20));
    const r2 = await ensureBuiltinDesignSkillsInstalledSafe({
      agentDirPath: tmpAgentDir,
    });
    // 缓存命中, 返回首次结果 (不是 0)
    expect(r2.written).toBe(5);
    // 但磁盘 mtime 不变 (没有重写)
    const mtimeAfter = statSync(
      getBuiltinSkillFilePath("design-initiation", tmpAgentDir),
    ).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
  });

  it("5 个并发 async 入口: 最终状态一致, 不出现中间态", async () => {
    const promises = Array.from({ length: 5 }, () =>
      ensureBuiltinDesignSkillsInstalledSafe({ agentDirPath: tmpAgentDir }),
    );
    const results = await Promise.all(promises);
    // 5 个返回结构一致
    for (const r of results) {
      expect(r.written).toBe(5);
    }
    // 5 个文件都到位
    for (const id of BUILTIN_DESIGN_SKILL_IDS) {
      expect(
        readFileSync(getBuiltinSkillFilePath(id, tmpAgentDir), "utf8"),
      ).toContain(`name: ${id}`);
    }
  });

  it("force=true: 绕过缓存, 覆盖 5 个", async () => {
    await ensureBuiltinDesignSkillsInstalledSafe({ agentDirPath: tmpAgentDir });
    // 用户改 1 个
    const target = getBuiltinSkillFilePath("design-initiation", tmpAgentDir);
    const original = readFileSync(target, "utf8");
    writeFileSync(target, original + "\n<!-- USER -->\n", "utf8");
    // force 重写
    const r = await ensureBuiltinDesignSkillsInstalledSafe({
      agentDirPath: tmpAgentDir,
      force: true,
    });
    expect(r.written).toBe(5);
    expect(readFileSync(target, "utf8")).not.toContain("USER");
  });

  it("缓存: 改磁盘文件后调 non-force, 仍然返回 cached (不重新 install)", async () => {
    const r1 = await ensureBuiltinDesignSkillsInstalledSafe({
      agentDirPath: tmpAgentDir,
    });
    expect(r1.written).toBe(5);
    // 用户改文件
    const target = getBuiltinSkillFilePath("design-process", tmpAgentDir);
    writeFileSync(target, "user content\n", "utf8");
    // non-force → 缓存命中, 不重新 install, 不重写用户改的内容
    const r2 = await ensureBuiltinDesignSkillsInstalledSafe({
      agentDirPath: tmpAgentDir,
    });
    expect(r2.written).toBe(5); // 返回首次结果
    // 用户内容仍在 (因为缓存命中, 没重写)
    expect(readFileSync(target, "utf8")).toBe("user content\n");
  });

  it("resetBuiltinSkillsInstallerCacheForTests 重置后能再次 install", async () => {
    await ensureBuiltinDesignSkillsInstalledSafe({ agentDirPath: tmpAgentDir });
    // 删 1 个
    rmSync(getBuiltinSkillFilePath("design-initiation", tmpAgentDir), {
      force: true,
    });
    // 重置缓存 + 再调
    resetBuiltinSkillsInstallerCacheForTests();
    const r = await ensureBuiltinDesignSkillsInstalledSafe({
      agentDirPath: tmpAgentDir,
    });
    expect(r.written).toBe(1);
    expect(r.skipped).toBe(4);
  });
});
