/**
 * 进程内 builtin design skills installer — 包装 shared/design-builtin-skills
 * 增加: (1) 进程内单例防止重复触发 (2) mutex 串行化并发 install
 * (3) 静默吞错 + log warn (不阻塞 session 启动 / app 启动).
 *
 * 触发时机:
 * - main 进程 bootRuntime 预热 (app 启动早期)
 * - 每个 session create 之后 fire-and-forget 兜底
 *
 * 失败恢复:
 * - 写盘失败 / 权限不足 → 静默 log warn, 下次触发重试
 * - 用户已改 SKILL.md → 不覆盖, 保留用户内容
 */
import {
  defaultAgentDirPath,
  ensureBuiltinDesignSkillsInstalled,
  type EnsureBuiltinSkillsOptions,
  type EnsureBuiltinSkillsResult,
} from "./design-builtin-skills";
import { withStoreLock } from "./lib/store-mutex";
import { dbgWarn } from "../../shared/debug-log";

const INSTALL_LOCK_KEY = "builtin-design-skills";

/** 进程内缓存: 按 agentDirPath 索引, 避免测试 / 多目录场景串. */
const cacheByAgentDir = new Map<string, EnsureBuiltinSkillsResult>();

function resolveAgentDirKey(options: EnsureBuiltinSkillsOptions): string {
  return options.agentDirPath ?? defaultAgentDirPath();
}

/**
 * 兜底 install 入口. 行为:
 * - 第一次调用: 真实 install, 串行化并发
 * - 后续调用 (无 force): 同 agentDirPath 走缓存, 不同 agentDirPath 重跑
 * - force=true: 重新 install, 覆盖缓存
 *
 * 不抛错: 写盘失败会被吞到 result.failed 列表.
 */
export async function ensureBuiltinDesignSkillsInstalledSafe(
  options: EnsureBuiltinSkillsOptions = {},
): Promise<EnsureBuiltinSkillsResult> {
  const force = options.force === true;
  const key = resolveAgentDirKey(options);
  if (!force) {
    const cached = cacheByAgentDir.get(key);
    if (cached) return cached;
  }
  return withStoreLock(INSTALL_LOCK_KEY, async () => {
    if (!force) {
      const cached = cacheByAgentDir.get(key);
      if (cached) return cached;
    }
    try {
      const result = ensureBuiltinDesignSkillsInstalled(options);
      cacheByAgentDir.set(key, result);
      if (result.failed.length > 0) {
        dbgWarn(
          "builtin-skills-installer",
          "some skills failed to install",
          result.failed.join(","),
        );
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dbgWarn("builtin-skills-installer", "install threw", message);
      // 不缓存异常, 下次可重试
      return { written: 0, skipped: 0, failed: ["__exception__"] };
    }
  });
}

/** 同步版 (供 main 进程 bootRuntime 启动预热). 失败抛错由 caller 决定. */
export function ensureBuiltinDesignSkillsInstalledSync(
  options: EnsureBuiltinSkillsOptions = {},
): EnsureBuiltinSkillsResult {
  const force = options.force === true;
  const key = resolveAgentDirKey(options);
  if (!force) {
    const cached = cacheByAgentDir.get(key);
    if (cached) return cached;
  }
  try {
    const result = ensureBuiltinDesignSkillsInstalled(options);
    cacheByAgentDir.set(key, result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dbgWarn("builtin-skills-installer", "sync install threw", message);
    return { written: 0, skipped: 0, failed: ["__exception__"] };
  }
}

/** 测试用: 重置进程内缓存. 不影响磁盘. */
export function resetBuiltinSkillsInstallerCacheForTests(): void {
  cacheByAgentDir.clear();
}
