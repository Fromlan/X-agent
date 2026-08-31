/**
 * Design session write guard.
 *
 * When the active session is of type "design", every Pi tool_call is checked:
 * read-only tools (read/grep/find/ls + godot readonly variants) pass through
 * with NO path constraint (策划需要读整个工作区做参考).
 *
 * Write-class tools (write / edit / godot mutating / etc.) MUST have their
 * path argument resolve to <cwd>/game-design/. Anything else is blocked with
 * a clear reason.
 *
 * Bash is treated as the existing plan-mode bash: command must be
 * isReadonlyBashCommand AND must not escape cwd (using getReadablePluginRoots
 * for plugin read roots, same as plan mode).
 *
 * write_plan is a special case: its output is a plan file in
 * ~/.pi/agent/x-agent/plans/, NOT inside game-design/. Per plan §2.3.5 we
 * exclude write_plan from DESIGN_SESSION_TYPE_TOOLS, so this guard will
 * never see it in practice. We keep the explicit block here as a safety net.
 *
 * For "code" sessions, this guard is a no-op.
 */
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { SessionType } from "../../../shared/session-type";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveInsideCwd } from "../cwd-sandbox";
import { getReadablePluginRoots } from "../plugin-host";
import {
  bashCommandEscapesCwd,
  isReadonlyBashCommand,
} from "./bash-readonly";

/** Folder under cwd that the design session may write to. */
export const DESIGN_DIR_NAME = "game-design";

/**
 * Cap on a single `write` tool call's `content` length (in characters) inside
 * a design session. Files larger than this are blocked so a single turn
 * cannot dump every source markdown into a new file (the issue behind the
 * 195k-context blowup: nine ~25k markdown rewrites in one turn).
 *
 * 30_000 chars ≈ 7.5k tokens, which fits comfortably under most cache
 * breakpoints. Files that need to be larger should be split across multiple
 * `edit` calls (search/replace) or sequenced across turns.
 */
export const DESIGN_WRITE_CONTENT_MAX_CHARS = 30_000;

/**
 * True iff `absOrRelPath` (after cwd-sandbox normalization) resolves inside
 * <cwd>/game-design/. Case-insensitive on Windows (matches cwd-sandbox).
 *
 * Accepts both absolute paths (already resolved) and cwd-relative paths.
 */
export function isInsideGameDesign(
  cwd: string,
  absOrRelPath: string,
): boolean {
  if (!cwd) return false;
  const target = resolve(cwd, absOrRelPath).toLowerCase();
  const gameDesignRoot = resolve(cwd, DESIGN_DIR_NAME).toLowerCase();
  if (target === gameDesignRoot) return true;
  return target.startsWith(gameDesignRoot + sep);
}

/** Resolve a Pi-style path the same way plan-mode-guard does. */
function normalizeToolPath(raw: string): string {
  let p = raw.trim();
  if (p.startsWith("@")) p = p.slice(1);
  if (p === "~") return homedir();
  if (p.startsWith("~/") || (process.platform === "win32" && p.startsWith("~\\"))) {
    return join(homedir(), p.slice(2));
  }
  if (/^file:\/\//.test(p)) {
    try {
      return fileURLToPath(p);
    } catch {
      return "\0";
    }
  }
  return p;
}

/**
 * Tools the guard classifies as "read-only" — they are allowed any path
 * (策划需要读项目代码做参考). All other tools are assumed mutating and
 * subject to the path check.
 */
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  // Core Pi builtins
  "read",
  "grep",
  "find",
  "ls",
  // Godot extension: pure introspection
  "godot_detect_project",
  "godot_editor_info",
  "godot_open_scenes",
  "godot_edited_scene",
  "godot_play_errors",
  "godot_get_scene_tree",
  "godot_get_node_properties",
  "godot_get_debugger_state",
  "godot_find_unused_resources",
  "godot_get_project_setting",
  "godot_lint_scripts",
  "godot_list_project_files",
  "godot_resolve_uid",
  "godot_list_global_classes",
  "godot_find_class_name_conflicts",
  "godot_inspect_script",
  "godot_list_export_presets",
  "godot_check_export_templates",
]);

/** Tools with a single string path argument we can check. */
const PATH_ARG: Record<string, string> = {
  write: "path",
  edit: "path",
  patch: "path",
  multi_edit: "path",
  // Godot mutating tools
  godot_set_project_setting: "key", // 项目设置 key (we additionally still block if it would mutate outside game-design via different guard)
  godot_open_scene: "path",
  godot_reload_scene: "path",
  godot_run_scene: "path",
  godot_run_main_scene: "projectPath",
  godot_import_resources: "path",
  godot_wait_for_import_done: "path",
  godot_set_breakpoint: "file",
};

/**
 * Decide whether a tool call should be blocked because the design session
 * tries to mutate outside <cwd>/game-design/.
 *
 * Returns { block: false } for:
 * - any non-design session type
 * - read-only tools (any path)
 * - bash with a readonly command that doesn't escape cwd
 * - write/edit with a path that resolves inside <cwd>/game-design/
 */
export function shouldBlockDesignSessionWrite(
  sessionType: SessionType,
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
  cwd: string | null,
): { block: boolean; reason?: string } {
  if (sessionType !== "design") return { block: false };
  if (!cwd) return { block: false };

  // Read-only tools pass through (策划需要读工作区任意位置做参考)
  if (READ_ONLY_TOOLS.has(toolName)) return { block: false };

  // bash: 走与 plan mode 相同的 readonly + cwd escape 双重判定
  if (toolName === "bash") {
    const command =
      typeof toolInput?.command === "string" ? toolInput.command : "";
    if (!isReadonlyBashCommand(command)) {
      return { block: true, reason: designBashBlockReason(command) };
    }
    if (
      bashCommandEscapesCwd(command, cwd, getReadablePluginRoots(cwd))
    ) {
      return { block: true, reason: designBashCwdEscapeBlockReason(command) };
    }
    return { block: false };
  }

  // write_plan: 设计会话禁用 (策划文档应直接 write 到 game-design/).
  // This is a safety net — base tools already exclude it.
  if (toolName === "write_plan") {
    return {
      block: true,
      reason: "策划会话禁用 write_plan：请直接用 write 工具写到 game-design/。",
    };
  }

  // godot_set_project_setting: key 不是路径，无法做 path 检查 → 拒绝。
  if (toolName === "godot_set_project_setting") {
    return {
      block: true,
      reason:
        "策划会话禁止修改 Godot 项目设置（godot_set_project_setting）。请新开代码会话再改。",
    };
  }

  // 写工具：必须有 path 参数，且必须落在 <cwd>/game-design/ 内
  const pathArg = PATH_ARG[toolName];
  if (!pathArg) {
    return {
      block: true,
      reason: `策划会话禁止调用「${toolName}」（未配置 path 检查，请改用 read 或 write 写到 game-design/）。`,
    };
  }
  const raw = toolInput?.[pathArg];
  if (typeof raw !== "string" || !raw) {
    return {
      block: true,
      reason: `策划会话需要明确写入路径（${toolName} ${pathArg}）。`,
    };
  }
  const normalized = normalizeToolPath(raw);
  // 先用 cwd-sandbox 把路径 resolve 进 cwd, 拒绝逃逸
  const inside = resolveInsideCwd(cwd, normalized);
  if (!inside.ok) {
    return {
      block: true,
      reason: `策划会话禁止读取项目外路径：${raw}`,
    };
  }
  // 已在 cwd 内, 但还需要落在 game-design/ 内
  if (!isInsideGameDesign(cwd, inside.abs)) {
    return {
      block: true,
      reason: `策划会话禁止在 game-design/ 外写入（${toolName} ${raw}）。`,
    };
  }
  // write 工具：单次 content 上限，避免一个 turn 整段铺大文件。
  if (toolName === "write") {
    const content = toolInput?.content;
    if (typeof content === "string" && content.length > DESIGN_WRITE_CONTENT_MAX_CHARS) {
      return {
        block: true,
        reason:
          `策划会话单次 write content 不得超过 ${DESIGN_WRITE_CONTENT_MAX_CHARS} 字符（当前 ${content.length}）。` +
          `请拆分为多次 edit，或分多个 turn 写入。`,
      };
    }
  }
  return { block: false };
}

function designBashBlockReason(command: string): string {
  return (
    `策划会话禁止执行写操作 bash 命令（${command.slice(0, 80)}）。` +
    `策划文档请用 write 工具写到 <cwd>/game-design/。`
  );
}

function designBashCwdEscapeBlockReason(command: string): string {
  return `策划会话禁止 bash 访问项目目录外路径。已拦截：${command.slice(0, 120)}`;
}

/** Compatibility: exported for tests and downstream consumers. */
export const _internals = {
  READ_ONLY_TOOLS,
  PATH_ARG,
  normalizeToolPath,
};

/**
 * Inline extension factory; getSessionType/getCwd read live SessionHost state.
 * Mirrors the createPlanModeGuardExtension shape.
 */
export function createDesignWriteGuardExtension(opts: {
  getSessionType: () => SessionType;
  getCwd: () => string | null;
}): InlineExtension {
  return (pi) => {
    pi.on("tool_call", async (event) => {
      const input =
        event && typeof event === "object" && "input" in event
          ? (event.input as Record<string, unknown>)
          : undefined;
      const decision = shouldBlockDesignSessionWrite(
        opts.getSessionType(),
        event.toolName,
        input,
        opts.getCwd?.() ?? null,
      );
      if (decision.block) {
        return { block: true, reason: decision.reason };
      }
      return undefined;
    });
  };
}
