/**
 * 启动期清理上一会话遗留的临时文件：
 * - atomicWrite 失败时保留的 `.tmp` / `.tmp.failed-*` 残留（rename 失败兜底）
 * - bash-liveness 探针目录中超过 1 小时的 probe 文件
 * - godot-rpc endpoint 文件超过 90 天未更新（token 长期有效风险）
 */
import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { getAgentDirPath } from "../prefs";
import { tmpdir } from "node:os";

const ONE_HOUR_MS = 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export type OrphanCleanupStats = {
  atomicTmp: number;
  bashProbes: number;
  oldEndpoints: number;
};

/** Best-effort cleanup; never throws — failures are silently dropped. */
export function cleanupOrphanTmpFiles(): OrphanCleanupStats {
  const stats: OrphanCleanupStats = {
    atomicTmp: 0,
    bashProbes: 0,
    oldEndpoints: 0,
  };
  try {
    const agentDir = getAgentDirPath();
    if (existsSync(agentDir)) {
      // 1. 清理残留 .tmp / .tmp.failed-* 兜底文件
      // 找 agentDir 顶级目录下的所有 .tmp / .tmp.failed-* 文件
      for (const name of readdirSync(agentDir)) {
        if (name.endsWith(".tmp") || name.includes(".tmp.failed-")) {
          try {
            unlinkSync(join(agentDir, name));
            stats.atomicTmp += 1;
          } catch {
            // ignore
          }
        }
      }
      // 2. 清理 godot-rpc endpoint 超过 90 天未更新
      const ep = join(agentDir, "x-agent-godot-rpc.json");
      if (existsSync(ep)) {
        try {
          const st = statSync(ep);
          if (Date.now() - st.mtimeMs > NINETY_DAYS_MS) {
            unlinkSync(ep);
            stats.oldEndpoints += 1;
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  // 3. 清理 bash-liveness 探针目录中的旧 probe
  try {
    const probeRoot = join(tmpdir(), "x-agent-bash-probes");
    if (existsSync(probeRoot)) {
      const now = Date.now();
      for (const name of readdirSync(probeRoot)) {
        const full = join(probeRoot, name);
        try {
          const st = statSync(full);
          if (!st.isDirectory() && now - st.mtimeMs > ONE_HOUR_MS) {
            unlinkSync(full);
            stats.bashProbes += 1;
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  return stats;
}
