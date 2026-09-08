/**
 * 工具白名单热切换 + 重建会话 (issue #59 主题 A 提取).
 *
 * Lifted out of SessionHost so the host facade stays focused on
 * "接 Pi 事件 + 路由到子编排器". applyTools is a discrete config
 * operation with its own non-trivial decision tree (hot switch →
 * missing-tools detection → registry check → session rebuild);
 * it can live here as a free function and be unit-tested.
 */
import {
  ALL_TOGGLEABLE_TOOLS,
  type NoticeReplaceKey,
} from "../../shared/ipc";
import type { SessionBundle } from "./session-lifecycle";
import type { OpenProjectResult } from "../../shared/ipc";
import { patchPrefs } from "./prefs";

/** Snapshot deps for applyTools. The host captures these once and passes
 *  them into the helper; the helper never reads `this.*`. */
export interface ApplyToolsDeps {
  getBundle(): SessionBundle | null;
  /** 当前是否是 Ask/Plan readonly mode. */
  isReadonlyMode(): boolean;
  /** 委托给 SessionModeController.applyReadonlyModeTools. */
  applyReadonlyModeTools(
    tools: string[],
  ): { ok: true } | { ok: false; error: string };
  /** 重建会话 (工具不在可切换清单 → 走 resume/openProject). */
  rebuildSession(): Promise<OpenProjectResult>;
  emitReplaceableNotice(
    replaceKey: NoticeReplaceKey,
    text: string,
    level?: "info" | "warn" | "error",
  ): void;
}

/**
 * 应用工具白名单。先尝试热切换；只有缺失的工具在可用清单内时才重建会话，
 * 且重建前后都会 emit notice，避免用户感到"会话无声闪烁"。
 *
 * Readonly mode (Ask / Plan) 走 SessionModeController.applyReadonlyModeTools
 * 走"更新 prefs + savedTools snapshot + 保留 ephemeral read-only tools"
 * 路径。
 */
export async function applyTools(
  deps: ApplyToolsDeps,
  tools: string[],
): Promise<{ ok: boolean; error?: string }> {
  void patchPrefs({ tools });
  const bundle = deps.getBundle();
  if (!bundle) return { ok: true };

  if (deps.isReadonlyMode()) {
    return deps.applyReadonlyModeTools(tools);
  }

  try {
    bundle.session.setActiveToolsByName(tools);
    deps.emitReplaceableNotice(
      "tools",
      "已更新工具白名单（系统提示已重建）。本会话前缀缓存将从下一轮重新积累。",
      "warn",
    );
    const active = new Set(bundle.session.getActiveToolNames());
    const missing = tools.filter((name) => !active.has(name));
    if (missing.length === 0) return { ok: true };

    // 不在可切换清单内的名字重建也注册不上：告警即可，不要反复重建会话。
    const registrable = new Set<string>(
      ALL_TOGGLEABLE_TOOLS as readonly string[],
    );
    const rebuildable = missing.filter((name) => registrable.has(name));
    if (rebuildable.length === 0) {
      deps.emitReplaceableNotice(
        "tools",
        `以下工具不在可用清单中，已忽略：${missing.join(", ")}`,
        "warn",
      );
      return { ok: true };
    }

    // Session was created before the full registry allowlist fix (or with a
    // narrower tools list). Recreate so newly enabled tools can register.
    deps.emitReplaceableNotice(
      "tools",
      `正在重建会话以启用工具：${rebuildable.join(", ")}（历史保留）`,
    );
    const result = await deps.rebuildSession();
    if (!result.ok) {
      const error =
        result.error ??
        `部分工具未能启用：${missing.join(", ")}。请重新打开项目。`;
      deps.emitReplaceableNotice("tools", error, "error");
      return { ok: false, error };
    }
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    deps.emitReplaceableNotice("tools", `应用工具失败：${error}`, "error");
    return { ok: false, error };
  }
}
