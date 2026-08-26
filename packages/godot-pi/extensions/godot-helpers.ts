/**
 * Godot helper extension for X-agent / Pi.
 * Registers /godot-rpc-status and a lightweight project detector tool.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  detectGodotProject,
  formatGodotProjectInfo,
} from "../helpers/godot-project-detect";

const RPC_METHODS =
  "ping, get_editor_info, get_open_scenes, get_edited_scene, open_scene, reload_scene, " +
  "get_scene_tree, get_node_properties, run_current_scene, play_main_scene, import_resources, " +
  "get_play_errors, stop_scene, get_debugger_state, set_breakpoint, find_unused_resources, " +
  "export_project, get_project_setting, set_project_setting, lint_scripts, " +
  "list_project_files, resolve_uid, wait_for_import_done, list_global_classes, " +
  "find_class_name_conflicts, inspect_script, list_export_presets, check_export_templates";

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
