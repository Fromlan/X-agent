/**
 * Builtin design skills — 5 个策划专用 skill, 懒写到 Pi 标准 user skill 路径
 * `~/.pi/agent/skills/design-{id}/SKILL.md` 让 Pi 的 `DefaultResourceLoader` 自动发现.
 *
 * 关键设计:body **不**预注入 system prompt; agent 通过 `read` 工具按需读全文.
 * `<available_skills>` 索引只暴露 frontmatter (name + description).
 *
 * 触发时机:
 * - `electron/agent/builtin-skills-installer.ts` (singleton + mutex)
 *   - main 进程启动时 fire-and-forget 预热
 *   - 每个 session start 后 fire-and-forget 兜底
 *
 * 用户自定义保护:首次 install 后记录 sha256 到
 * `~/.pi/agent/x-agent/builtin-skills-installed.json`;若磁盘 SKILL.md sha256 不在
 * 记录里(说明用户改过),跳过 install 不覆盖. 只有显式 `force: true` 才覆盖.
 *
 * Body 来源 (2026-08-31 收口, issue #68 主题 J C-101):
 * 5 条 SKILL.md 正文从 .ts 模板字符串外迁到 `apps/desktop/electron/agent/skills/builtin/<id>/SKILL.md`,
 * build 时由 Vite `?raw` import 内联进 bundle,dev + packaged + vitest 一致可用.
 */
import { createHash, randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { homedir } from "os";
import { posix as path } from "path";

// ===== 5 条 BUILTIN body — 从独立 .md 文件 build-time 内联 =====

import SKILL_INITIATION_BODY from "./skills/builtin/design-initiation/SKILL.md?raw";
import SKILL_PROCESS_BODY from "./skills/builtin/design-process/SKILL.md?raw";
import SKILL_SYSTEMS_BODY from "./skills/builtin/design-systems/SKILL.md?raw";
import SKILL_NUMERICAL_BODY from "./skills/builtin/design-numerical/SKILL.md?raw";
import SKILL_CORE_LOOP_BODY from "./skills/builtin/design-core-loop/SKILL.md?raw";

/** 默认 Pi agent 根目录: 复用项目约定的 ~/.pi/agent. 测试可注入. */
export function defaultAgentDirPath(): string {
  return path.join(homedir(), ".pi", "agent");
}

/** 单条 BUILTIN skill 的 source-of-truth 定义. */
export type DesignBuiltinSkill = {
  /** 目录名 + frontmatter name + `<available_skills>` 名字, 全小写、连字符分隔. */
  id: string;
  /** 人类可读标签 (frontmatter name 直接复用). */
  name: string;
  /** frontmatter description, 1..240 字符 (Pi 校验 headroom 1024). */
  description: string;
  /** 完整 markdown body (200..2400 字符), 仅在 agent `read` SKILL.md 时进 context. */
  body: string;
};

// ===== 5 条 BUILTIN 常量 =====

const SKILL_INITIATION: DesignBuiltinSkill = {
  id: "design-initiation",
  name: "design-initiation",
  description:
    "游戏立项策划：从模糊创意到 GDD / 原型清单 / 批判性分析的完整工作坊. 触发：用户提新游戏想法、要做立项评估、问 GDD 怎么写.",
  body: SKILL_INITIATION_BODY,
};

const SKILL_PROCESS: DesignBuiltinSkill = {
  id: "design-process",
  name: "design-process",
  description:
    "游戏开发流程纪律：5 阶段边界 + 想法池 + 设计/代码分离 + 周节奏. 触发：用户问下一步做什么、项目阶段混乱、出现边写边改、设计与代码互相污染.",
  body: SKILL_PROCESS_BODY,
};

const SKILL_SYSTEMS: DesignBuiltinSkill = {
  id: "design-systems",
  name: "design-systems",
  description:
    "游戏系统设计三件套：角色三视图 / 世界观框架 / 关卡机制. 触发：用户要设计角色、世界观、关卡等可玩系统层资产.",
  body: SKILL_SYSTEMS_BODY,
};

const SKILL_NUMERICAL: DesignBuiltinSkill = {
  id: "design-numerical",
  name: "design-numerical",
  description:
    "游戏数值设计：属性 / 武器 / 掉落 / 经济四类表 + 数值平衡方法. 触发：用户要设计角色属性、武器数值、掉落表、经济系统、平衡手感.",
  body: SKILL_NUMERICAL_BODY,
};

const SKILL_CORE_LOOP: DesignBuiltinSkill = {
  id: "design-core-loop",
  name: "design-core-loop",
  description:
    "核心玩法循环定义：30s 短期循环 + 长期目标 + 乐趣来源四象限 + 循环验证 checklist. 触发：用户要梳理核心玩法、问'我做的游戏好玩在哪'.",
  body: SKILL_CORE_LOOP_BODY,
};

/** 全部 5 条 BUILTIN 的导出 (按 frontmatter 顺序). */
export const DESIGN_BUILTIN_SKILLS: readonly DesignBuiltinSkill[] = [
  SKILL_INITIATION,
  SKILL_PROCESS,
  SKILL_SYSTEMS,
  SKILL_NUMERICAL,
  SKILL_CORE_LOOP,
] as const;

/** 5 条 id, 与 `prioritizeDesignSkills` 排序对齐. */
export const BUILTIN_DESIGN_SKILL_IDS: readonly string[] =
  DESIGN_BUILTIN_SKILLS.map((s) => s.id);

// ===== 懒写辅助 =====

/** 拼 frontmatter + body 成完整 SKILL.md 文本. */
export function formatSkillMdContent(skill: DesignBuiltinSkill): string {
  return (
    `---\n` +
    `name: ${skill.name}\n` +
    `description: ${JSON.stringify(skill.description)}\n` +
    `---\n\n` +
    `${skill.body.trimEnd()}\n`
  );
}

/** 算 SHA-256 hex. */
function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** 默认 user skill 安装目录: ${agentDirPath}/skills/. */
export function getBuiltinSkillsInstallDir(agentDirPath: string = defaultAgentDirPath()): string {
  return path.join(agentDirPath, "skills");
}

/** 给定 id 返回完整 SKILL.md 路径. */
export function getBuiltinSkillFilePath(id: string, agentDirPath?: string): string {
  return path.join(getBuiltinSkillsInstallDir(agentDirPath), id, "SKILL.md");
}

/** install 记录文件: ~/.pi/agent/x-agent/builtin-skills-installed.json. */
export function getInstallRecordPath(agentDirPath: string): string {
  return path.join(agentDirPath, "x-agent", "builtin-skills-installed.json");
}

type InstallRecord = {
  /** 安装时间, ISO 字符串. */
  installedAt: string;
  /** 记录每个 BUILTIN id 的 SHA-256 (内容稳定后才记). */
  sha256: Record<string, string>;
};

function readInstallRecord(agentDirPath: string): InstallRecord {
  const p = getInstallRecordPath(agentDirPath);
  if (!existsSync(p)) return { installedAt: new Date(0).toISOString(), sha256: {} };
  try {
    const raw = readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as Partial<InstallRecord>;
    return {
      installedAt: typeof parsed.installedAt === "string" ? parsed.installedAt : new Date(0).toISOString(),
      sha256: (parsed.sha256 ?? {}) as Record<string, string>,
    };
  } catch {
    return { installedAt: new Date(0).toISOString(), sha256: {} };
  }
}

function writeInstallRecord(agentDirPath: string, record: InstallRecord): void {
  const p = getInstallRecordPath(agentDirPath);
  mkdirSync(path.join(agentDirPath, "x-agent"), { recursive: true });
  // 简单原子写:写 .tmp 后 rename
  const tmp = `${p}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(record, null, 2), "utf8");
  // rename 在同 volume 上是原子的 (NTFS MoveFileExW + POSIX rename)
  renameSync(tmp, p);
}

export type EnsureBuiltinSkillsOptions = {
  /** 强制覆盖所有 5 个 BUILTIN (无视 sha256 记录). */
  force?: boolean;
  /** 测试可注入: agentDir 路径. 默认 process.env.X_AGENT_AGENT_DIR ?? ~/.pi/agent */
  agentDirPath?: string;
};

export type EnsureBuiltinSkillsResult = {
  /** 实际写入的文件数 (新建 + 覆盖). */
  written: number;
  /** 跳过的文件数 (磁盘 sha256 与记录一致, 跳过). */
  skipped: number;
  /** 失败的 id 列表 (权限等). 不抛错, 静默吞. */
  failed: string[];
};

/**
 * 把 5 条 BUILTIN SKILL.md 懒写到 ~/.pi/agent/skills/design-<id>/SKILL.md.
 *
 * 幂等策略 (用户修改保护):
 * 1. 文件不存在 → 写入
 * 2. 文件存在 + sha256 与上次记录一致 → 跳过
 * 3. 文件存在 + sha256 与记录不一致 → 用户改过, **跳过不覆盖** (用户内容优先)
 * 4. force: true → 无视所有跳过, 强制覆盖所有
 *
 * 不抛错: 写盘失败返回 failed 列表, caller 决定怎么处理.
 */
export function ensureBuiltinDesignSkillsInstalled(
  options: EnsureBuiltinSkillsOptions = {},
): EnsureBuiltinSkillsResult {
  const agentDirPath = options.agentDirPath ?? defaultAgentDirPath();

  const skillsDir = getBuiltinSkillsInstallDir(agentDirPath);
  const record = options.force
    ? { installedAt: new Date(0).toISOString(), sha256: {} as Record<string, string> }
    : readInstallRecord(agentDirPath);

  const result: EnsureBuiltinSkillsResult = { written: 0, skipped: 0, failed: [] };
  const newSha: Record<string, string> = { ...record.sha256 };
  const force = options.force === true;

  // 一次性建好 skills 目录
  try {
    mkdirSync(skillsDir, { recursive: true });
  } catch (err) {
    // 整个 install 没法做, 直接返回
    return {
      written: 0,
      skipped: 0,
      failed: DESIGN_BUILTIN_SKILLS.map((s) => s.id),
    };
  }

  for (const skill of DESIGN_BUILTIN_SKILLS) {
    const targetDir = path.join(skillsDir, skill.id);
    const targetPath = path.join(targetDir, "SKILL.md");
    const content = formatSkillMdContent(skill);
    const sha = sha256Hex(content);

    try {
      if (existsSync(targetPath) && !force) {
        const onDisk = readFileSync(targetPath, "utf8");
        // 内容完全一致 (含我自己的 sha) → 跳过, 维持记录
        if (onDisk === content) {
          newSha[skill.id] = sha;
          result.skipped += 1;
          continue;
        }
        // 内容不一致 → 用户改过 (或上次写盘后外部改动), 默认保留, 不覆盖
        // (下次 install 还会重新比对, 仍能识别为\"用户改过\")
        result.skipped += 1;
        continue;
      }
      // 写盘 (新建 / 不存在 / force 覆盖)
      mkdirSync(targetDir, { recursive: true });
      const tmp = `${targetPath}.${randomUUID()}.tmp`;
      writeFileSync(tmp, content, "utf8");
      renameSync(tmp, targetPath);
      newSha[skill.id] = sha;
      result.written += 1;
    } catch {
      result.failed.push(skill.id);
    }
  }

  // 写记录: 只在至少有一次成功写入或之前有记录时
  if (Object.keys(newSha).length > 0 || record.sha256) {
    try {
      writeInstallRecord(agentDirPath, {
        installedAt: new Date().toISOString(),
        sha256: newSha,
      });
    } catch {
      // 记录写失败不影响 install 结果
    }
  }

  return result;
}
