/**
 * shared/godot-rpc 子模块 — 策略 (issue #60 主题 D C-302).
 *
 * 只含 clamp + timeout 决策函数, 不含协议类型 (在 ./protocol.ts) 和白名单
 * (在 ./gating.ts). 这一层回答"调 godotRpcRequest 的 timeout 应该是多少".
 *
 * - clampGodotRunWaitMs: 钳制 play 场景方法的 wait_ms (default 3000, max 15000)
 * - clampGodotWaitMs: 钳制 wait_for_import_done / wait_for_break 的 timeout_ms
 * - clampGodotListLimit: 钳制 list_project_files 的 limit
 * - godotRpcTimeoutMs: 综合决策每个 call 的 RPC 超时
 *
 * 1.3 增加的 3 个常量 (GODOT_LIST_FILES_DEFAULT_LIMIT /
 * GODOT_LIST_FILES_MAX_LIMIT / GODOT_WAIT_DEFAULT_TIMEOUT_MS /
 * GODOT_WAIT_MAX_TIMEOUT_MS) 也在本文件 — 因为它们是 clamp 决策的上界.
 */
import {
  GODOT_RPC_BASE_TIMEOUT_MS,
  GODOT_RPC_DEFAULT_WAIT_MS,
  GODOT_RPC_EXPORT_GRACE_MS,
  GODOT_RPC_EXPORT_TIMEOUT_MS,
  GODOT_RPC_MAX_WAIT_MS,
  type GodotRpcCall,
} from "./protocol";

/** Clamp `wait_ms` for play scene methods (default 3000, max 15000). */
export function clampGodotRunWaitMs(raw: unknown): number {
  // 负数视为非法 → 回退默认收集窗口（0 保留 = 不等待）。
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.min(GODOT_RPC_MAX_WAIT_MS, Math.floor(raw));
  }
  return GODOT_RPC_DEFAULT_WAIT_MS;
}

function isPlayWaitMethod(method: string): boolean {
  return method === "run_current_scene" || method === "play_main_scene";
}

/** 1.3：list_project_files 默认上限，避免 Agent 一次性吞下整个项目树。 */
export const GODOT_LIST_FILES_DEFAULT_LIMIT = 500;
/** 1.3：list_project_files / wait_for_import_done 上限，防止 Tool 描述被巨大参数撑爆。 */
export const GODOT_LIST_FILES_MAX_LIMIT = 5000;
/** 1.3：wait_for_import_done / wait_for_break 默认等待时长（ms）。 */
export const GODOT_WAIT_DEFAULT_TIMEOUT_MS = 30_000;
/** 1.3：wait_for_import_done / wait_for_break 最长允许等待（ms）。 */
export const GODOT_WAIT_MAX_TIMEOUT_MS = 60_000;

/** 钳制 wait_for_import_done / wait_for_break 的 timeout_ms。 */
export function clampGodotWaitMs(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.min(GODOT_WAIT_MAX_TIMEOUT_MS, Math.floor(raw));
  }
  return GODOT_WAIT_DEFAULT_TIMEOUT_MS;
}

/** 钳制 list_project_files 的 limit。 */
export function clampGodotListLimit(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1) {
    return Math.min(GODOT_LIST_FILES_MAX_LIMIT, Math.floor(raw));
  }
  return GODOT_LIST_FILES_DEFAULT_LIMIT;
}

/** RPC timeout for a call (play wait + base timeout for play methods). */
export function godotRpcTimeoutMs(call: GodotRpcCall): number {
  if (isPlayWaitMethod(call.method)) {
    const wait =
      "wait_ms" in call ? clampGodotRunWaitMs(call.wait_ms) : GODOT_RPC_DEFAULT_WAIT_MS;
    return wait + GODOT_RPC_BASE_TIMEOUT_MS;
  }
  // 项目导出走 Godot 子进程出包，最慢档（5 分钟 + 启动余量，保证插件先收尾）。
  if (call.method === "export_project") {
    return GODOT_RPC_EXPORT_TIMEOUT_MS + GODOT_RPC_EXPORT_GRACE_MS;
  }
  // wait_for_import_done：用户窗口 + 1s 基线（wait_for_break 同模式，待 1.3 调试回路 PR 启用）。
  if (call.method === "wait_for_import_done") {
    const wait =
      "timeout_ms" in call
        ? clampGodotWaitMs(call.timeout_ms)
        : GODOT_WAIT_DEFAULT_TIMEOUT_MS;
    return wait + GODOT_RPC_BASE_TIMEOUT_MS;
  }
  // 资源导入 / 全项目扫描 / 批量脚本解析可能较慢。
  if (
    call.method === "import_resources" ||
    call.method === "find_unused_resources" ||
    call.method === "lint_scripts" ||
    call.method === "list_project_files" ||
    call.method === "inspect_script" ||
    call.method === "find_class_name_conflicts"
  ) {
    return GODOT_RPC_BASE_TIMEOUT_MS * 4;
  }
  return GODOT_RPC_BASE_TIMEOUT_MS;
}
