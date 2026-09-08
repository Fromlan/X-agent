/**
 * Godot helper extension for X-agent / Pi.
 * Registers /godot-rpc-status and a lightweight project detector tool.
 *
 * 主题 I (issue #66 C-406) — RPC method 列表 single-source of truth:
 * 改 `apps/desktop/shared/godot-rpc/protocol.ts` 的 `GODOT_RPC_METHOD_NAMES`
 * 这一处即可, 本文件从同一源消费, 不再 hardcode CSV.
 * cross-check 测试 `apps/desktop/shared/godot-rpc.test.ts` 锁住
 * `godot-helpers.ts` 解析出来的 method 集合 == `GODOT_RPC_METHOD_NAMES`.
 *
 * packages/godot-pi 是 npm 子包, 不能 reverse-import apps/desktop; 这里
 * 用相对路径访问 apps/desktop/shared/godot-rpc/protocol.ts. 该文件没有
 * 任何 import 依赖 (纯常量 + 类型), 所以即使是子包也能直接拿.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { GODOT_RPC_METHOD_NAMES } from "../../../apps/desktop/shared/godot-rpc/protocol";
import {
  detectGodotProject,
  formatGodotProjectInfo,
} from "../helpers/godot-project-detect";

const RPC_METHODS = GODOT_RPC_METHOD_NAMES.join(", ");

export default function godotHelpersExtension(pi: ExtensionAPI): void {
  pi.registerCommand("godot-rpc-status", {
    description: "Show how to connect X-agent Godot editor RPC",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        `Godot RPC: enable X-agent RPC addon → connect via ~/.pi/agent/x-agent-godot-rpc.json (default 127.0.0.1:8765). Methods: ${RPC_METHODS}. In X-agent, enable Godot tools under Settings → Tools. Multi-editor: pick the active client in Settings → Godot RPC.`,
        "info",
      );
    },
  });

  pi.registerTool({
    name: "godot_detect_project",
    label: "Detect Godot project",
    description:
      "Detect whether cwd (or a given path) is a Godot project and report config_version / name / main scene.",
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({ description: "Project root; defaults to session cwd" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const root = params.path || ctx.cwd;
      const info = detectGodotProject(root);
      return {
        content: [{ type: "text" as const, text: formatGodotProjectInfo(info) }],
        details: info,
      };
    },
  });
}
