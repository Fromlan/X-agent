/**
 * Pi custom tools that drive the Godot editor via GodotRpcBridge.
 */
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { GodotRpcBridge } from "./godot-rpc-bridge";
import type { GodotRpcCall, GodotRpcResponse } from "../../shared/godot-rpc";
import {
  clampGodotRunWaitMs,
  godotRpcTimeoutMs,
} from "../../shared/godot-rpc";

function textResult(text: string, details: unknown = {}) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

async function callBridge(
  bridge: GodotRpcBridge,
  call: GodotRpcCall,
): Promise<GodotRpcResponse> {
  return bridge.request(
    { ...call, id: randomUUID() },
    godotRpcTimeoutMs(call),
  );
}

function formatResponse(res: GodotRpcResponse): {
  content: Array<{ type: "text"; text: string }>;
  details: unknown;
} {
  if (!res.ok) {
    return textResult(`Godot RPC error: ${res.error}`, {
      ok: false,
      error: res.error,
    });
  }
  const body =
    typeof res.result === "string"
      ? res.result
      : JSON.stringify(res.result, null, 2);
  return textResult(body, { ok: true, result: res.result });
}

type PlayErrorEntry = { severity?: string; message?: string };

function formatRunResult(result: unknown): string {
  if (!result || typeof result !== "object") {
    return JSON.stringify(result, null, 2);
  }
  const r = result as {
    started?: boolean;
    playing?: boolean;
    waitMs?: number;
    playMethod?: string;
    errors?: PlayErrorEntry[];
  };
  const errors = Array.isArray(r.errors) ? r.errors : [];
  const lines: string[] = [
    `Scene play requested via ${r.playMethod ?? "play"} (waitMs=${r.waitMs ?? "?"}).`,
    `stillPlaying=${Boolean(r.playing)}.`,
  ];
  if (errors.length === 0) {
    lines.push("No errors/warnings captured during the wait window.");
  } else {
    lines.push(`Captured ${errors.length} message(s):`);
    for (let i = 0; i < errors.length; i++) {
      const e = errors[i]!;
      lines.push(
        `${i + 1}. [${String(e.severity ?? "error").toUpperCase()}] ${String(e.message ?? "")}`,
      );
    }
  }
  return lines.join("\n");
}

async function executePlay(
  bridge: GodotRpcBridge,
  method: "run_current_scene" | "play_main_scene",
  waitMs: number,
) {
  const res = await callBridge(bridge, {
    method,
    wait_ms: waitMs,
  });
  if (!res.ok) {
    return textResult(`Godot RPC error: ${res.error}`, {
      ok: false,
      error: res.error,
    });
  }
  const text = formatRunResult(res.result);
  const errors = Array.isArray((res.result as { errors?: unknown })?.errors)
    ? ((res.result as { errors: PlayErrorEntry[] }).errors ?? [])
    : [];
  const hasError = errors.some((e) => e.severity === "error");
  return textResult(hasError ? `Play finished with errors.\n${text}` : text, {
    ok: true,
    result: res.result,
    hasError,
  });
}

const emptyParams = Type.Object({});

const pathParams = Type.Object({
  path: Type.String({
    description: "Godot scene path, e.g. res://scenes/main.tscn",
  }),
});

const runParams = Type.Object({
  wait_ms: Type.Optional(
    Type.Number({
      description:
        "How long to collect debugger/output errors after play (ms). Default 3000, max 15000.",
    }),
  ),
});

const importParams = Type.Object({
  paths: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "res:// paths to reimport. Omit or pass [] to trigger a full EditorFileSystem.scan().",
    }),
  ),
});

const playErrorsParams = Type.Object({
  clear: Type.Optional(
    Type.Boolean({
      description:
        "If true, clear the error buffer after reading. Default false.",
    }),
  ),
});

export function createGodotTools(bridge: GodotRpcBridge): ToolDefinition[] {
  return [
    defineTool({
      name: "godot_editor_info",
      label: "Godot editor info",
      description:
        "Query the connected Godot editor: version, project path, edited scene, play state.",
      promptSnippet: "godot_editor_info: read Godot editor / project status",
      parameters: emptyParams,
      async execute() {
        return formatResponse(
          await callBridge(bridge, { method: "get_editor_info" }),
        );
      },
    }),
    defineTool({
      name: "godot_open_scenes",
      label: "Godot open scenes",
      description: "List scene tabs currently open in the Godot editor.",
      promptSnippet: "godot_open_scenes: list open scene tabs",
      parameters: emptyParams,
      async execute() {
        return formatResponse(
          await callBridge(bridge, { method: "get_open_scenes" }),
        );
      },
    }),
    defineTool({
      name: "godot_edited_scene",
      label: "Godot edited scene",
      description:
        "Get the currently edited scene path and whether a scene is playing.",
      promptSnippet: "godot_edited_scene: current edited scene + play state",
      parameters: emptyParams,
      async execute() {
        return formatResponse(
          await callBridge(bridge, { method: "get_edited_scene" }),
        );
      },
    }),
    defineTool({
      name: "godot_open_scene",
      label: "Godot open scene",
      description: "Open a scene path in the Godot editor.",
      promptSnippet: "godot_open_scene: open res:// scene in editor",
      parameters: pathParams,
      async execute(_id, params) {
        return formatResponse(
          await callBridge(bridge, {
            method: "open_scene",
            path: params.path,
          }),
        );
      },
    }),
    defineTool({
      name: "godot_reload_scene",
      label: "Godot reload scene",
      description:
        "Reload a scene in the Godot editor (opens it first if not already open). Use after editing .tscn files on disk.",
      promptSnippet: "godot_reload_scene: reload scene after disk edits",
      promptGuidelines: [
        "After structural edits to a .tscn, call godot_reload_scene with the scene path so the editor picks up changes.",
      ],
      parameters: pathParams,
      async execute(_id, params) {
        return formatResponse(
          await callBridge(bridge, {
            method: "reload_scene",
            path: params.path,
          }),
        );
      },
    }),
    defineTool({
      name: "godot_run_scene",
      label: "Godot run scene",
      description:
        "Play the currently edited scene (like F6), wait briefly, and return any debugger/output errors captured during that window.",
      promptSnippet:
        "godot_run_scene: play current scene and collect errors for ~3s",
      promptGuidelines: [
        "After godot_run_scene, read the returned errors list. If errors are present, fix scripts/scenes accordingly.",
        "For longer play sessions, call godot_play_errors later to fetch newer errors.",
      ],
      parameters: runParams,
      async execute(_id, params) {
        return executePlay(
          bridge,
          "run_current_scene",
          clampGodotRunWaitMs(params.wait_ms),
        );
      },
    }),
    defineTool({
      name: "godot_run_main_scene",
      label: "Godot run main scene",
      description:
        "Play the project's main scene (like F5), wait briefly, and return debugger/output errors.",
      promptSnippet:
        "godot_run_main_scene: play project main scene (F5) and collect errors",
      promptGuidelines: [
        "Prefer godot_run_main_scene when validating the full game boot path; use godot_run_scene for the currently edited scene.",
      ],
      parameters: runParams,
      async execute(_id, params) {
        return executePlay(
          bridge,
          "play_main_scene",
          clampGodotRunWaitMs(params.wait_ms),
        );
      },
    }),
    defineTool({
      name: "godot_import_resources",
      label: "Godot import resources",
      description:
        "Trigger Godot EditorFileSystem import: full scan when paths omitted, or reimport specific res:// paths after writing assets on disk.",
      promptSnippet:
        "godot_import_resources: scan or reimport assets in the editor",
      promptGuidelines: [
        "After writing/replacing textures, audio, or other importable assets, call godot_import_resources with those res:// paths (or omit paths for a full scan).",
      ],
      parameters: importParams,
      async execute(_id, params) {
        return formatResponse(
          await callBridge(bridge, {
            method: "import_resources",
            paths: Array.isArray(params.paths) ? params.paths : [],
          }),
        );
      },
    }),
    defineTool({
      name: "godot_play_errors",
      label: "Godot play errors",
      description:
        "Read buffered play/debugger errors from the last (or ongoing) scene run. Use after godot_run_scene for longer sessions.",
      promptSnippet: "godot_play_errors: read buffered play errors",
      parameters: playErrorsParams,
      async execute(_id, params) {
        return formatResponse(
          await callBridge(bridge, {
            method: "get_play_errors",
            clear: Boolean(params.clear),
          }),
        );
      },
    }),
    defineTool({
      name: "godot_stop_scene",
      label: "Godot stop scene",
      description: "Stop the scene currently playing in the Godot editor.",
      promptSnippet: "godot_stop_scene: stop playing scene",
      parameters: emptyParams,
      async execute() {
        return formatResponse(
          await callBridge(bridge, { method: "stop_scene" }),
        );
      },
    }),
  ];
}
