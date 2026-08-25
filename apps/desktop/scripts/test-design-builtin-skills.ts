/**
 * 策划 builtin design skills 端到端契约 (issue #23, mock 模式, 不依赖 Electron / Pi).
 * 验证:
 * 1. 5 条 BUILTIN 写盘契约 (frontmatter + body)
 * 2. 懒写幂等性 (二次 install 0 字节写)
 * 3. 用户修改不覆盖
 * 4. force 重写
 * 5. 5 条 SKILL.md 路径能被 `applyXAgentSkillsFilter` 顶置
 * 6. 进程内 cache 命中 (多次 install 只一次写盘)
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import {
  BUILTIN_DESIGN_SKILL_IDS,
  DESIGN_BUILTIN_SKILLS,
  ensureBuiltinDesignSkillsInstalled,
  formatSkillMdContent,
  getBuiltinSkillFilePath,
  getInstallRecordPath,
} from "../electron/agent/design-builtin-skills.ts";
import { applyXAgentSkillsFilter } from "../electron/agent/filter-session-skills.ts";

const tmp = mkdtempSync(join(tmpdir(), "x-agent-builtin-skills-"));
try {
  // —— 1. 5 条 BUILTIN 写盘契约 ——
  console.log("[1] 5 条 BUILTIN 写盘契约");
  const r1 = ensureBuiltinDesignSkillsInstalled({ agentDirPath: tmp });
  assert.equal(r1.written, 5, "首次 install 应写 5 个");
  assert.equal(r1.skipped, 0);
  for (const id of BUILTIN_DESIGN_SKILL_IDS) {
    const p = getBuiltinSkillFilePath(id, tmp);
    const text = readFileSync(p, "utf8");
    assert.match(text, /^---\nname: design-/, `${id} 含 frontmatter name`);
    assert.match(text, /\ndescription: "/, `${id} description 用 JSON.stringify 包裹`);
    assert.ok(text.length > 500, `${id} body 应 > 500 字符`);
  }
  // 5 条 description 总和 ≤ 1200 字符
  const totalDesc = DESIGN_BUILTIN_SKILLS.reduce(
    (sum, s) => sum + s.description.length,
    0,
  );
  assert.ok(totalDesc <= 1200, `5 description 总和 ${totalDesc} 应 ≤ 1200`);

  // —— 2. 懒写幂等性 ——
  console.log("[2] 懒写幂等性");
  const mtimeBefore = statSync(
    getBuiltinSkillFilePath("design-initiation", tmp),
  ).mtimeMs;
  // 睡 20ms 让 mtime 可比较
  await new Promise((r) => setTimeout(r, 20));
  const r2 = ensureBuiltinDesignSkillsInstalled({ agentDirPath: tmp });
  assert.equal(r2.written, 0, "二次 install 应 0 字节写");
  assert.equal(r2.skipped, 5);
  const mtimeAfter = statSync(
    getBuiltinSkillFilePath("design-initiation", tmp),
  ).mtimeMs;
  assert.equal(mtimeBefore, mtimeAfter, "mtime 不应改变");

  // —— 3. 用户修改不覆盖 ——
  console.log("[3] 用户修改不覆盖");
  const target = getBuiltinSkillFilePath("design-systems", tmp);
  const original = readFileSync(target, "utf8");
  writeFileSync(target, original + "\n<!-- USER CUSTOMIZED -->\n", "utf8");
  const r3 = ensureBuiltinDesignSkillsInstalled({ agentDirPath: tmp });
  assert.equal(r3.written, 0, "用户改过, 默认不覆盖");
  assert.equal(r3.skipped, 5);
  const afterUserEdit = readFileSync(target, "utf8");
  assert.ok(afterUserEdit.includes("USER CUSTOMIZED"), "用户内容保留");

  // —— 4. force 重写 ——
  console.log("[4] force 重写");
  const r4 = ensureBuiltinDesignSkillsInstalled({
    agentDirPath: tmp,
    force: true,
  });
  assert.equal(r4.written, 5, "force 应写 5 个");
  const afterForce = readFileSync(target, "utf8");
  assert.ok(!afterForce.includes("USER CUSTOMIZED"), "force 后用户内容被覆盖");

  // —— 5. install 记录文件 ——
  console.log("[5] install 记录文件");
  const recordPath = getInstallRecordPath(tmp);
  assert.ok(existsSync(recordPath), "install 记录文件存在");
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  assert.ok(typeof record.installedAt === "string");
  assert.equal(
    Object.keys(record.sha256).sort().join(","),
    [...BUILTIN_DESIGN_SKILL_IDS].sort().join(","),
    "5 个 sha256 都记录",
  );

  // —— 6. applyXAgentSkillsFilter 顶置 ——
  console.log("[6] applyXAgentSkillsFilter 顶置");
  // 模拟 Pi 给我们的 skills 列表 (含 5 个 BUILTIN + 一些无关 skill)
  const fakeSkillList = [
    ...BUILTIN_DESIGN_SKILL_IDS.map((id) => ({
      name: id,
      description: "",
      filePath: getBuiltinSkillFilePath(id, tmp),
    })),
    { name: "some-other-skill", description: "", filePath: "/tmp/other/SKILL.md" },
    { name: "godot-docs-4-7", description: "", filePath: "/tmp/godot/SKILL.md" },
  ];
  const designFiltered = applyXAgentSkillsFilter(
    fakeSkillList,
    tmp,
    [],
    "design",
  );
  // 前 5 条应是 5 个 BUILTIN (按 BUILTIN_DESIGN_SKILL_IDS 顺序)
  const top5 = designFiltered.slice(0, 5).map((s) => s.name);
  assert.deepEqual(top5, [...BUILTIN_DESIGN_SKILL_IDS], "design 顶置 5 个 BUILTIN");
  // code session 不顶置 (按原顺序, 但 5 个 BUILTIN 保留)
  const codeFiltered = applyXAgentSkillsFilter(fakeSkillList, tmp, [], "code");
  const codeHas5 = BUILTIN_DESIGN_SKILL_IDS.every((id) =>
    codeFiltered.some((s) => s.name === id),
  );
  assert.ok(codeHas5, "code session 保留 5 个 BUILTIN (不删除)");

  // —— 7. formatSkillMdContent 格式 ——
  console.log("[7] formatSkillMdContent 格式");
  const sample = DESIGN_BUILTIN_SKILLS[0];
  const formatted = formatSkillMdContent(sample);
  assert.ok(formatted.startsWith("---\n"), "frontmatter 起始");
  assert.ok(formatted.includes(`name: ${sample.name}`));
  assert.ok(formatted.includes(`description: ${JSON.stringify(sample.description)}`));
  assert.ok(formatted.includes(sample.body.trimEnd()), "含 body");

  // —— 8. 路径解析 ——
  console.log("[8] 路径解析");
  assert.equal(
    getBuiltinSkillFilePath("design-initiation", "/tmp/x"),
    posix.join("/tmp/x", "skills", "design-initiation", "SKILL.md"),
    "getBuiltinSkillFilePath 拼路径",
  );

  console.log("OK — 策划 builtin design skills 端到端契约通过");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
