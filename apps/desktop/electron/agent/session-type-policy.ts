/**
 * SessionTypePolicy — the single home for all "策划会话允许什么" decisions.
 *
 * Before this module existed, the same `if (type === "design")` lived in 9
 * places (see ADR 2026-08-26-session-type-policy). Adding a new session type
 * meant editing 6 files in lock-step. This deep module consolidates the
 * concept:
 *
 *   interface SessionTypePolicy
 *     - toolPreset(prefsTools)        : the type-level tool whitelist
 *     - systemAppend()                : extra system-prompt text for the type
 *     - shouldBlockWriteTool(...)     : the type-level mutating-tool guard
 *     - filterSkills(skills)          : type-aware skill reordering / filtering
 *     - persistenceSchema()           : sidecar key + default for the type
 *
 *   class CodePolicy    — passthrough; type adds no constraint
 *   class DesignPolicy  — implements all 5 methods (game-design/ write gate)
 *
 *   createSessionTypePolicy(type?)  — factory. DEFAULT 兜底集中在这里:
 *     undefined / unknown / missing → CodePolicy. This is the ONLY place
 *     that knows about DEFAULT_SESSION_TYPE → 唯一兜底点.
 *
 * 跨域 (shared/ + electron/agent/ + session-mode/) 共享 strategy,
 * 后续加 code-strict / gamedev-only 等新 type 只需新增 class,不再改 6 文件.
 */
import {
  DEFAULT_SESSION_TYPE,
  type SessionType,
} from "../../shared/session-type";
import {
  DESIGN_SESSION_TYPE_TOOLS,
  computeDesignSessionTypeTools,
  computeCodeSessionTypeTools,
} from "../../shared/session-type-tools";
import { buildDesignSessionTypeAppend } from "../../shared/mode-prompt";
import { shouldBlockDesignSessionWrite } from "./session-mode/design-write-guard";
import { applyXAgentSkillsFilter } from "./filter-session-skills";

/** Minimal skill shape — matches what filter-session-skills accepts. */
export type SessionTypeSkill = {
  name?: string;
  filePath: string;
  description?: string;
};

/**
 * Decision surface for one session type. Implementations are pure / immutable
 * (no shared mutable state); the orchestrator caches one instance per session
 * bundle.
 */
export interface SessionTypePolicy {
  readonly type: SessionType;

  /**
   * Type-level tool whitelist. The mode controller (ask/plan/agent/goal) may
   * narrow further, but the type itself defines the base set.
   * For design sessions this is the readonly core + write/edit (guarded).
   * For code sessions this is `prefsTools` verbatim.
   */
  toolPreset(prefsTools: readonly string[]): readonly string[];

  /**
   * Extra system-prompt text injected BEFORE the mode-level append, so the
   * type-level constraint is always visible regardless of mode.
   * Returns "" for code sessions.
   */
  systemAppend(): string;

  /**
   * Authoritative decision on whether a tool_call should be blocked because
   * it would mutate outside the type's allowed scope.
   * For code sessions always false. For design sessions: delegate to the
   * design-write-guard (paths outside <cwd>/game-design/ → blocked).
   *
   * Fail-safe: if any exception is thrown, the implementation must catch it
   * and return false (passthrough), matching the "code is unconstrained"
   * baseline. Throwing from this method must never crash a tool_call.
   */
  shouldBlockWriteTool(
    name: string,
    args: Record<string, unknown> | undefined,
    cwd: string | null,
  ): { block: boolean; reason?: string };

  /**
   * Apply type-aware reordering / filtering to the skill list. cwd is needed
   * because the existing godot-skill filter is cwd-dependent (already in
   * applyXAgentSkillsFilter). disabledSkills is the user preference list.
   */
  filterSkills(
    skills: readonly SessionTypeSkill[],
    cwd: string,
    disabledSkills: readonly string[],
  ): readonly SessionTypeSkill[];

  /**
   * Sidecar persistence key + default. For code/design this is stable;
   * future types might want their own key (e.g. encrypted design docs).
   */
  persistenceSchema(): { key: string; default: SessionType };
}

/** Code session policy: prefs.tools 原样,无任何 type 约束. */
export class CodePolicy implements SessionTypePolicy {
  readonly type: SessionType = "code";

  toolPreset(prefsTools: readonly string[]): readonly string[] {
    return computeCodeSessionTypeTools(prefsTools);
  }

  systemAppend(): string {
    return "";
  }

  shouldBlockWriteTool(
    _name: string,
    _args: Record<string, unknown> | undefined,
    _cwd: string | null,
  ): { block: boolean } {
    return { block: false };
  }

  filterSkills(
    skills: readonly SessionTypeSkill[],
    cwd: string,
    disabledSkills: readonly string[],
  ): readonly SessionTypeSkill[] {
    return applyXAgentSkillsFilter(
      skills as SessionTypeSkill[],
      cwd,
      disabledSkills,
      "code",
    );
  }

  persistenceSchema(): { key: string; default: SessionType } {
    return { key: "session-type", default: "code" };
  }
}

/**
 * Design session policy: write/edit 只允许落到 <cwd>/game-design/,tools 基线
 * 由 DESIGN_SESSION_TYPE_TOOLS 决定,system append 注入策划说明,skills 重新
 * 排序让 design-* 优先.
 */
export class DesignPolicy implements SessionTypePolicy {
  readonly type: SessionType = "design";

  toolPreset(prefsTools: readonly string[]): readonly string[] {
    return computeDesignSessionTypeTools(prefsTools);
  }

  systemAppend(): string {
    return buildDesignSessionTypeAppend();
  }

  shouldBlockWriteTool(
    name: string,
    args: Record<string, unknown> | undefined,
    cwd: string | null,
  ): { block: boolean; reason?: string } {
    try {
      return shouldBlockDesignSessionWrite("design", name, args, cwd);
    } catch (err) {
      // Fail-safe: any throw becomes "do not block" (matches code baseline).
      // 守卫绝不能让 tool_call 崩溃,即使参数异常.
      console.warn(
        `[session-type-policy] shouldBlockWriteTool(${name}) threw; falling back to passthrough:`,
        err instanceof Error ? err.message : String(err),
      );
      return { block: false };
    }
  }

  filterSkills(
    skills: readonly SessionTypeSkill[],
    cwd: string,
    disabledSkills: readonly string[],
  ): readonly SessionTypeSkill[] {
    return applyXAgentSkillsFilter(
      skills as SessionTypeSkill[],
      cwd,
      disabledSkills,
      "design",
    );
  }

  persistenceSchema(): { key: string; default: SessionType } {
    return { key: "session-type", default: "design" };
  }
}

/** All policy classes — keeps the factory's dispatch table honest. */
const POLICIES: Readonly<Record<SessionType, SessionTypePolicy>> = {
  code: new CodePolicy(),
  design: new DesignPolicy(),
};

/**
 * Factory: type → 对应 policy 实例.
 *
 * DEFAULT 兜底: undefined / invalid → CodePolicy.
 * 整个 codebase 唯一一处把未知值兜底成 DEFAULT_SESSION_TYPE 的地方.
 * 旧代码里的 `getBundle()?.sessionType ?? DEFAULT_SESSION_TYPE` 三连调用
 * 模式可以替换成 `createSessionTypePolicy(getBundle()?.sessionType)`.
 */
export function createSessionTypePolicy(
  type: SessionType | undefined | null,
): SessionTypePolicy {
  if (type === "design") return POLICIES.design;
  // 包括 undefined / null / "code" / 任何未来扩展 → 走 CodePolicy.
  return POLICIES.code;
}

/**
 * Convenience: re-export the design base tool set for callers that still
 * want a "raw" constant. New code should prefer `policy.toolPreset(prefsTools)`.
 */
export { DESIGN_SESSION_TYPE_TOOLS };

/** Re-export DEFAULT 兜底以避免外部直接读 DEFAULT_SESSION_TYPE 写兜底逻辑. */
export { DEFAULT_SESSION_TYPE };
