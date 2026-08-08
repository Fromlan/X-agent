/**
 * Ask/Plan hard gate: block non-allowlisted tools via Pi tool_call extension.
 * Bash is allowlisted but commands must pass the read-only classifier + cwd check.
 * read/grep/find/ls are allowlisted but their `path` argument must stay inside
 * the project cwd (Pi tools resolve `~`, absolute paths and `file://` freely).
 */
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { AgentSessionMode } from "../../../shared/ipc";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveInsideCwd } from "../cwd-sandbox";
import {
  bashCommandEscapesCwd,
  cwdEscapeBashBlockReason,
  isReadonlyBashCommand,
  readonlyBashBlockReason,
} from "./bash-readonly";

/** Tool name → its path argument (path-carrying allowlisted read tools). */
const PATH_TOOL_ARG: Record<string, string> = {
  read: "path",
  grep: "path",
  find: "path",
  ls: "path",
  // godot-pi 扩展：只读探测任意目录的 project.godot，同样限制在项目 cwd 内。
  godot_detect_project: "path",
};

/**
 * Normalize a Pi tool path the same way Pi's `resolvePath` does
 * (`~` / `~/`, `@` prefix, `file://`), so the cwd sandbox sees the real target.
 */
function normalizeToolPath(raw: string): string {
  let p = raw.trim();
  if (p.startsWith("@")) p = p.slice(1);
  if (p === "~") return homedir();
  if (
    p.startsWith("~/") ||
    (process.platform === "win32" && p.startsWith("~\\"))
  ) {
    return join(homedir(), p.slice(2));
  }
  if (/^file:\/\//.test(p)) {
    try {
      return fileURLToPath(p);
    } catch {
      // win32 下 `file:///etc/passwd` 等非法 file URL 无法转路径 → 必然拦截
      // （NUL 会让 resolveInsideCwd 判为非法路径）。
      return "\0";
    }
  }
  return p;
}

/** Block a path-carrying read tool call that escapes the project cwd. */
function blockEscapingPathToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd: string,
): { block: boolean; reason?: string } {
  const argName = PATH_TOOL_ARG[toolName];
  const raw = toolInput[argName];
  if (raw === undefined) return { block: false }; // default = cwd itself
  if (typeof raw !== "string" || raw.includes("\0")) {
    return {
      block: true,
      reason: `${toolName} 的路径参数不合法。`,
    };
  }
  const normalized = normalizeToolPath(raw);
  const res = resolveInsideCwd(cwd, normalized);
  if (!res.ok) {
    return {
      block: true,
      reason: `调研/Plan 模式禁止读取项目目录外路径（${toolName} ${raw.slice(0, 80)}）。`,
    };
  }
  return { block: false };
}

export function shouldBlockReadonlyModeToolCall(
  mode: AgentSessionMode,
  toolName: string,
  allowedTools: readonly string[],
  toolInput?: Record<string, unknown>,
  cwd?: string | null,
): { block: boolean; reason?: string } {
  if (mode !== "ask" && mode !== "plan") return { block: false };

  if (toolName === "bash") {
    if (!allowedTools.includes("bash")) {
      return {
        block: true,
        reason:
          mode === "ask"
            ? "调研模式禁止调用工具「bash」。"
            : "Plan 模式禁止调用工具「bash」。",
      };
    }
    const command =
      typeof toolInput?.command === "string" ? toolInput.command : "";
    if (!isReadonlyBashCommand(command)) {
      return {
        block: true,
        reason: readonlyBashBlockReason(command || "(empty)"),
      };
    }
    if (cwd && bashCommandEscapesCwd(command, cwd)) {
      return { block: true, reason: cwdEscapeBashBlockReason(command) };
    }
    return { block: false };
  }

  // 路径类只读工具（read/grep/find/ls）：参数必须落在项目 cwd 内
  // （Pi 工具会展开 ~ / 绝对路径 / file://，不受 cwd 约束）。
  if (PATH_TOOL_ARG[toolName] && cwd) {
    const pathCheck = blockEscapingPathToolCall(toolName, toolInput ?? {}, cwd);
    if (pathCheck.block) return pathCheck;
  }

  if (allowedTools.includes(toolName)) return { block: false };
  if (mode === "ask") {
    return {
      block: true,
      reason: `调研模式禁止调用工具「${toolName}」。请使用只读研究（read/grep/find/ls/只读 bash），或切换到 Plan / Agent。`,
    };
  }
  return {
    block: true,
    reason: `Plan 模式禁止调用工具「${toolName}」。请使用只读研究（read/grep/find/ls/只读 bash）或 write_plan。`,
  };
}

/** Inline extension factory; getMode/getAllowedTools/getCwd read live SessionHost state. */
export function createPlanModeGuardExtension(opts: {
  getMode: () => AgentSessionMode;
  getAllowedTools: () => readonly string[];
  getCwd?: () => string | null;
}): InlineExtension {
  return (pi) => {
    pi.on("tool_call", async (event) => {
      const input =
        event && typeof event === "object" && "input" in event
          ? (event.input as Record<string, unknown>)
          : undefined;
      const decision = shouldBlockReadonlyModeToolCall(
        opts.getMode(),
        event.toolName,
        opts.getAllowedTools(),
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
