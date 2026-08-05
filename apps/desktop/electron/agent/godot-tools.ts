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

type LintIssue = { line?: number; column?: number; message?: string; severity?: string };
type LintFile = { path?: string; ok?: boolean; issues?: LintIssue[] };

/** 格式化 lint_scripts 结果：按文件列出通过 / 失败与问题清单。 */
function formatLintResult(result: unknown): string {
  if (!result || typeof result !== "object") {
    return JSON.stringify(result, null, 2);
  }
  const files = Array.isArray((result as { files?: unknown }).files)
    ? ((result as { files: LintFile[] }).files ?? [])
    : [];
  if (files.length === 0) {
    return "No scripts to report.";
  }
  const lines: string[] = [];
  for (const f of files) {
    const path = String(f.path ?? "?");
    if (f.ok) {
      lines.push(`OK  ${path}`);
      continue;
    }
    const issues = Array.isArray(f.issues) ? f.issues : [];
    if (issues.length === 0) {
      lines.push(`FAIL ${path} (no details)`);
      continue;
    }
    for (const issue of issues) {
      const loc = issue.line ? `:${issue.line}` : "";
      const sev = String(issue.severity ?? "error").toUpperCase();
      lines.push(`[${sev}] ${path}${loc} — ${String(issue.message ?? "")}`);
    }
  }
  return lines.join("\n");
}

type ExportResult = {
  ok?: boolean;
  timedOut?: boolean;
  outputPath?: string;
  errors?: string[];
  logTail?: string;
};

/** 格式化 export_project 结果：状态 + 输出路径 + 错误摘要。 */
function formatExportResult(result: unknown): string {
  if (!result || typeof result !== "object") {
    return JSON.stringify(result, null, 2);
  }
  const r = result as ExportResult;
  const lines: string[] = [];
  if (r.ok) {
    lines.push(`Export succeeded → ${String(r.outputPath ?? "?")}`);
  } else if (r.timedOut) {
    lines.push(`Export TIMED OUT after 5 minutes. Output: ${String(r.outputPath ?? "?")}`);
  } else {
    lines.push(`Export failed. Output: ${String(r.outputPath ?? "?")}`);
  }
  const errors = Array.isArray(r.errors) ? r.errors : [];
  for (const e of errors.slice(0, 10)) {
    lines.push(`  ${e}`);
  }
  return lines.join("\n");
}

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

const sceneTreeParams = Type.Object({
  path: Type.String({
    description: "Godot scene path to inspect, e.g. res://scenes/main.tscn",
  }),
  max_depth: Type.Optional(
    Type.Number({
      description:
        "Maximum depth of the serialized node tree. Default 8, capped to 16 to keep the response bounded.",
      minimum: 1,
      maximum: 16,
    }),
  ),
});

const nodePropertiesParams = Type.Object({
  path: Type.String({
    description: "Godot scene path that contains the node, e.g. res://scenes/main.tscn",
  }),
  node_path: Type.String({
    description:
      "NodePath relative to the scene root, e.g. \"Player/Sprite2D\".",
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

const projectSettingParams = Type.Object({
  key: Type.String({
    description:
      'ProjectSettings key path, e.g. "application/config/name" or "display/window/size/viewport_width".',
  }),
});

const setProjectSettingParams = Type.Object({
  key: Type.String({
    description:
      'ProjectSettings key path to write, e.g. "application/run/main_scene". The key is saved to project.godot immediately.',
  }),
  value: Type.Unknown({
    description:
      "New value for the setting (string / number / boolean / array / object).",
  }),
});

const lintScriptsParams = Type.Object({
  paths: Type.Array(Type.String(), {
    description: "res:// .gd script paths to parse-check, e.g. [\"res://player.gd\"].",
  }),
});

const unusedResourcesParams = Type.Object({
  root: Type.Optional(
    Type.String({
      description:
        'Directory to scan, res:// relative, e.g. "res://scenes". Default "res://".',
    }),
  ),
});

const exportProjectParams = Type.Object({
  preset: Type.String({
    description:
      'Export preset name defined in export_presets.cfg, e.g. "Windows Desktop".',
  }),
  output_dir: Type.String({
    description:
      "Absolute output file path (e.g. D:/builds/game.exe) or directory; the export may take minutes.",
  }),
  debug: Type.Optional(
    Type.Boolean({
      description: "Use the debug export template (--export-debug). Default false (release).",
    }),
  ),
});

const breakpointParams = Type.Object({
  file: Type.String({
    description: "res:// script path to place the breakpoint on, e.g. res://player.gd.",
  }),
  line: Type.Number({
    description: "1-based source line of the breakpoint.",
    minimum: 1,
  }),
  condition: Type.Optional(
    Type.String({
      description:
        "Accepted for API compatibility; Godot 4 breakpoints do not support conditions (ignored).",
    }),
  ),
  remove: Type.Optional(
    Type.Boolean({
      description: "If true, remove the breakpoint instead of adding it. Default false.",
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
    defineTool({
      name: "godot_get_scene_tree",
      label: "Godot scene tree",
      description:
        "Read the serialized node tree of a scene (name, type, script path, children). Useful for inspecting structure before editing.",
      promptSnippet: "godot_get_scene_tree: read scene node tree",
      promptGuidelines: [
        "Prefer godot_get_scene_tree over opening the scene in the editor when you only need a structural overview.",
        "If the tree is huge, lower max_depth (default 8) and inspect the relevant subtree by re-calling with a more specific path.",
      ],
      parameters: sceneTreeParams,
      async execute(_id, params) {
        const depth = Math.max(
          1,
          Math.min(16, Math.floor(params.max_depth ?? 8)),
        );
        return formatResponse(
          await callBridge(bridge, {
            method: "get_scene_tree",
            path: params.path,
            max_depth: depth,
          }),
        );
      },
    }),
    defineTool({
      name: "godot_get_node_properties",
      label: "Godot node properties",
      description:
        "Read exported/script-variable properties of a node inside a scene (name, type, hint). Read-only; does not mutate editor state.",
      promptSnippet: "godot_get_node_properties: read node property descriptors",
      promptGuidelines: [
        "Use godot_get_node_properties when you need to confirm a property name or type before writing to it.",
        "Pair with godot_get_scene_tree to discover node paths.",
      ],
      parameters: nodePropertiesParams,
      async execute(_id, params) {
        return formatResponse(
          await callBridge(bridge, {
            method: "get_node_properties",
            path: params.path,
            node_path: params.node_path,
          }),
        );
      },
    }),
    defineTool({
      name: "godot_get_project_setting",
      label: "Godot project setting",
      description:
        "Read a ProjectSettings value from the connected project (e.g. application/config/name, display/window/size/viewport_width). Read-only.",
      promptSnippet: "godot_get_project_setting: read project setting by key",
      promptGuidelines: [
        "Check godot_get_project_setting before assuming a project setting exists; the response includes an exists flag.",
      ],
      parameters: projectSettingParams,
      async execute(_id, params) {
        return formatResponse(
          await callBridge(bridge, {
            method: "get_project_setting",
            key: params.key,
          }),
        );
      },
    }),
    defineTool({
      name: "godot_set_project_setting",
      label: "Godot set project setting",
      description:
        "Write a ProjectSettings value and save it to project.godot (e.g. display/window/size/viewport_width). Mutates the project config file.",
      promptSnippet: "godot_set_project_setting: write + save project setting",
      promptGuidelines: [
        "Only set values that belong in project.godot. The editor applies most settings on next reload.",
        "Verify with godot_get_project_setting afterwards.",
      ],
      parameters: setProjectSettingParams,
      async execute(_id, params) {
        return formatResponse(
          await callBridge(bridge, {
            method: "set_project_setting",
            key: params.key,
            value: params.value,
          }),
        );
      },
    }),
    defineTool({
      name: "godot_lint_scripts",
      label: "Godot lint scripts",
      description:
        "Parse-check one or more res:// .gd scripts and report parse errors with file/line info. Read-only.",
      promptSnippet: "godot_lint_scripts: parse-check gd scripts",
      promptGuidelines: [
        "After writing or editing .gd files, run godot_lint_scripts on them to catch parse errors before play testing.",
        "Each failed file lists issues as [SEVERITY] path:line — message.",
      ],
      parameters: lintScriptsParams,
      async execute(_id, params) {
        const res = await callBridge(bridge, {
          method: "lint_scripts",
          paths: Array.isArray(params.paths) ? params.paths : [],
        });
        if (!res.ok) {
          return textResult(`Godot RPC error: ${res.error}`, {
            ok: false,
            error: res.error,
          });
        }
        const text = formatLintResult(res.result);
        const files = Array.isArray((res.result as { files?: unknown })?.files)
          ? ((res.result as { files: LintFile[] }).files ?? [])
          : [];
        const hasError = files.some(
          (f) => !f.ok && (f.issues ?? []).some((i) => i.severity === "error"),
        );
        return textResult(hasError ? `Lint found issues.\n${text}` : text, {
          ok: true,
          result: res.result,
          hasError,
        });
      },
    }),
    defineTool({
      name: "godot_find_unused_resources",
      label: "Godot find unused resources",
      description:
        "Scan the project (or a res:// subdirectory) for scenes/scripts/resources not referenced by any text resource path or uid. Read-only; class_name scripts are treated as referenced.",
      promptSnippet: "godot_find_unused_resources: find orphan assets",
      promptGuidelines: [
        "Use before cleaning up assets: verify each reported path is really removable.",
        "Scans can take a few seconds on large projects.",
      ],
      parameters: unusedResourcesParams,
      async execute(_id, params) {
        return formatResponse(
          await callBridge(bridge, {
            method: "find_unused_resources",
            root: typeof params.root === "string" ? params.root : "res://",
          }),
        );
      },
    }),
    defineTool({
      name: "godot_export_project",
      label: "Godot export project",
      description:
        "Export the project via a Godot headless subprocess using an export preset from export_presets.cfg. Can take minutes; returns success, output path, and captured errors.",
      promptSnippet: "godot_export_project: build a release/debug export",
      promptGuidelines: [
        "The preset name must exist in export_presets.cfg (unknown presets return the available list).",
        "Export templates must be installed for the editor, otherwise the export fails with template errors.",
        "Do not run godot_export_project while the editor is mid-import; the subprocess runs --import first.",
      ],
      parameters: exportProjectParams,
      async execute(_id, params) {
        const res = await callBridge(bridge, {
          method: "export_project",
          preset: params.preset,
          output_dir: params.output_dir,
          debug: Boolean(params.debug),
        });
        if (!res.ok) {
          return textResult(`Godot RPC error: ${res.error}`, {
            ok: false,
            error: res.error,
          });
        }
        const r = res.result as ExportResult;
        const text = formatExportResult(res.result);
        const ok = Boolean(r.ok);
        return textResult(ok ? text : `Export reported failure.\n${text}`, {
          ok: true,
          result: res.result,
          hasError: !ok || Boolean(r.timedOut),
        });
      },
    }),
    defineTool({
      name: "godot_get_debugger_state",
      label: "Godot debugger state",
      description:
        "Read the current debugger status: play state, active debug sessions (active/breaked/debuggable), breakpoint hit count, pending breakpoints, and buffered play errors. Read-only.",
      promptSnippet: "godot_get_debugger_state: read debugger / play status",
      promptGuidelines: [
        "Use before godot_run_scene to confirm the previous run stopped cleanly, or after a break to confirm state.",
      ],
      parameters: emptyParams,
      async execute() {
        return formatResponse(
          await callBridge(bridge, { method: "get_debugger_state" }),
        );
      },
    }),
    defineTool({
      name: "godot_set_breakpoint",
      label: "Godot set breakpoint",
      description:
        "Add or remove a script breakpoint in the editor (file + line). Applied to active debug sessions and replayed on new ones. Godot 4 breakpoints have no condition support.",
      promptSnippet: "godot_set_breakpoint: toggle editor breakpoint",
      promptGuidelines: [
        "Set a breakpoint before godot_run_scene, then poll godot_get_debugger_state / godot_play_errors to observe the break.",
        "Use remove=true to clear a breakpoint you no longer need.",
      ],
      parameters: breakpointParams,
      async execute(_id, params) {
        return formatResponse(
          await callBridge(bridge, {
            method: "set_breakpoint",
            file: params.file,
            line: Math.max(1, Math.floor(params.line)),
            condition: typeof params.condition === "string" ? params.condition : "",
            remove: Boolean(params.remove),
          }),
        );
      },
    }),
  ];
}
