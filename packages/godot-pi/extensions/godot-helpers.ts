/**
 * Godot helper extension for X-agent / Pi.
 * Registers /godot-rpc-status and a lightweight project detector tool.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const RPC_METHODS =
  "ping, get_editor_info, get_open_scenes, get_edited_scene, open_scene, reload_scene, run_current_scene, play_main_scene, import_resources, get_play_errors, stop_scene";

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
      const projectFile = join(root, "project.godot");
      if (!existsSync(projectFile)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Not a Godot project root: missing project.godot under ${root}`,
            },
          ],
          details: { isGodot: false, root },
        };
      }
      const text = readFileSync(projectFile, "utf8");
      const nameMatch = text.match(/config\/name\s*=\s*"([^"]+)"/);
      const versionMatch = text.match(/config_version\s*=\s*(\d+)/);
      const mainMatch = text.match(/run\/main_scene\s*=\s*"([^"]+)"/);
      const name = nameMatch?.[1] ?? "(unnamed)";
      const configVersion = versionMatch?.[1] ?? "?";
      const mainScene = mainMatch?.[1] ?? "";
      return {
        content: [
          {
            type: "text" as const,
            text: `Godot project "${name}" (config_version=${configVersion}) at ${root}${
              mainScene ? `; main_scene=${mainScene}` : ""
            }`,
          },
        ],
        details: {
          isGodot: true,
          root,
          name,
          configVersion,
          mainScene: mainScene || null,
        },
      };
    },
  });
}
