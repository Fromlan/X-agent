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
  clampGodotListLimit,
  clampGodotRunWaitMs,
  clampGodotWaitMs,
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

    // === 1.3: 只读文件内省 / UID / 类名 / 脚本反射 / 导出预检 ===

    defineTool({
      name: "godot_list_project_files",
      label: "Godot list project files",
      description:
        "Enumerate files under a res:// directory via the EditorFileSystem. Returns paths with kind (scene/script/resource/...) and optional uid. Read-only; paged by cursor.",
      promptSnippet: "godot_list_project_files: enumerate res:// files",
      promptGuidelines: [
        "Prefer this before walking the project tree with bash/shell tools — it understands res:// paths and uid:// links.",
        "Use type/pattern to narrow first; only widen or request the next page when you actually need more.",
      ],
      parameters: Type.Object({
        root: Type.Optional(
          Type.String({
            description:
              "res:// directory to start from. Default 'res://'. Subdirectories must end with '/'.",
          }),
        ),
        type: Type.Optional(
          Type.String({
            description:
              "Filter by kind: scene|script|shader|resource|texture|audio|other. Empty = no filter.",
          }),
        ),
        pattern: Type.Optional(
          Type.String({
            description:
              "Simple substring filter on the path (case-insensitive). Empty = no filter.",
          }),
        ),
        limit: Type.Optional(
          Type.Number({
            description: "Max files in this page (1..5000). Default 500.",
            minimum: 1,
            maximum: 5000,
          }),
        ),
        cursor: Type.Optional(
          Type.String({
            description:
              "res:// subdirectory to resume from (use nextCursor from the previous response).",
          }),
        ),
      }),
      async execute(_id, params) {
        const limit = clampGodotListLimit(params.limit);
        const res = await callBridge(bridge, {
          method: "list_project_files",
          root: typeof params.root === "string" && params.root ? params.root : "res://",
          type: typeof params.type === "string" ? params.type : "",
          pattern: typeof params.pattern === "string" ? params.pattern : "",
          limit,
          cursor: typeof params.cursor === "string" ? params.cursor : "",
        });
        if (!res.ok) {
          return textResult(`Godot RPC error: ${res.error}`, {
            ok: false,
            error: res.error,
          });
        }
        const r = res.result as {
          root?: string;
          total?: number;
          files?: Array<{ path: string; type?: string; uid?: string }>;
          nextCursor?: string | null;
          truncated?: boolean;
        };
        const files = Array.isArray(r.files) ? r.files : [];
        const lines: string[] = [];
        lines.push(
          `list_project_files under ${String(r.root ?? "res://")}: total=${String(r.total ?? files.length)}, returned=${files.length}`,
        );
        for (const f of files) {
          const uid = f.uid ? ` [${f.uid}]` : "";
          lines.push(`  ${String(f.type ?? "other")}\t${f.path}${uid}`);
        }
        if (r.nextCursor) {
          lines.push(`nextCursor=${r.nextCursor}`);
        }
        if (r.truncated) {
          lines.push("(result truncated by limit)");
        }
        return textResult(lines.join("\n"), {
          ok: true,
          result: res.result,
          hasError: false,
        });
      },
    }),

    defineTool({
      name: "godot_resolve_uid",
      label: "Godot resolve uid",
      description:
        "Resolve between res:// path and uid:// identifier using Godot 4.4+ ResourceUID. Pass exactly one of uid or path.",
      promptSnippet: "godot_resolve_uid: res:// ↔ uid://",
      parameters: Type.Object({
        uid: Type.Optional(
          Type.String({
            description:
              "uid:// identifier, e.g. 'uid://b3p8f2vqx4k1y'. Provide this OR path, not both.",
          }),
        ),
        path: Type.Optional(
          Type.String({
            description:
              "res:// path, e.g. 'res://player.gd'. Provide this OR uid, not both.",
          }),
        ),
      }),
      async execute(_id, params) {
        const uid = typeof params.uid === "string" ? params.uid : "";
        const path = typeof params.path === "string" ? params.path : "";
        if (!uid && !path) {
          return textResult(
            "Provide either 'uid' or 'path' (exactly one).",
            { ok: false, error: "missing input" },
          );
        }
        if (uid && path) {
          return textResult(
            "Pass only one of 'uid' or 'path', not both.",
            { ok: false, error: "ambiguous input" },
          );
        }
        const res = await callBridge(bridge, {
          method: "resolve_uid",
          uid,
          path,
        });
        if (!res.ok) {
          return textResult(`Godot RPC error: ${res.error}`, {
            ok: false,
            error: res.error,
          });
        }
        const r = res.result as {
          uid?: string;
          path?: string;
          exists?: boolean;
        };
        return textResult(
          `exists=${Boolean(r.exists)} uid=${String(r.uid ?? "")} path=${String(r.path ?? "")}`,
          { ok: true, result: res.result, hasError: !r.exists },
        );
      },
    }),

    defineTool({
      name: "godot_wait_for_import_done",
      label: "Godot wait for import done",
      description:
        "Block until Godot finishes reimporting the given res:// paths (or the editor scan completes). Returns which paths remain pending after the timeout.",
      promptSnippet:
        "godot_wait_for_import_done: wait for EditorFileSystem import",
      promptGuidelines: [
        "After writing or replacing textures/audio/importable assets, call this with those paths before reloading scenes that reference them.",
        "If remaining is non-empty, the import is still running; either retry with a longer timeout_ms or godot_import_resources to force a reimport.",
      ],
      parameters: Type.Object({
        paths: Type.Array(Type.String(), {
          description:
            "res:// paths to wait for, e.g. ['res://textures/hero.png'].",
        }),
        timeout_ms: Type.Optional(
          Type.Number({
            description:
              "How long to wait (ms). Default 30000, max 60000. Set 0 to return immediately.",
            minimum: 0,
            maximum: 60000,
          }),
        ),
      }),
      async execute(_id, params) {
        const timeoutMs = clampGodotWaitMs(params.timeout_ms);
        const paths = Array.isArray(params.paths) ? params.paths : [];
        if (paths.length === 0) {
          return textResult("paths must not be empty.", {
            ok: false,
            error: "missing paths",
          });
        }
        const res = await callBridge(bridge, {
          method: "wait_for_import_done",
          paths,
          timeout_ms: timeoutMs,
        });
        if (!res.ok) {
          return textResult(`Godot RPC error: ${res.error}`, {
            ok: false,
            error: res.error,
          });
        }
        const r = res.result as {
          ok?: boolean;
          remaining?: string[];
          elapsedMs?: number;
        };
        const remaining = Array.isArray(r.remaining) ? r.remaining : [];
        const text = remaining.length === 0
          ? `Import complete after ${String(r.elapsedMs ?? "?")}ms.`
          : `Import still pending for ${remaining.length} path(s) after ${String(r.elapsedMs ?? "?")}ms:\n  ${remaining.join("\n  ")}`;
        return textResult(text, {
          ok: true,
          result: res.result,
          hasError: !r.ok || remaining.length > 0,
        });
      },
    }),

    defineTool({
      name: "godot_list_global_classes",
      label: "Godot list global classes",
      description:
        "List every project class_name registered in ProjectSettings (class, language, path, icon). Read-only.",
      promptSnippet:
        "godot_list_global_classes: enumerate registered class_name",
      parameters: emptyParams,
      async execute() {
        return formatResponse(
          await callBridge(bridge, { method: "list_global_classes" }),
        );
      },
    }),

    defineTool({
      name: "godot_find_class_name_conflicts",
      label: "Godot find class name conflicts",
      description:
        "Scan res:// .gd scripts (optionally including addons) for class_name declarations that duplicate a registered global class or collide between scripts. Read-only.",
      promptSnippet:
        "godot_find_class_name_conflicts: detect duplicate class_name",
      promptGuidelines: [
        "Useful when a script fails to load with a 'class name already taken' error or when merging branches that register conflicting names.",
      ],
      parameters: Type.Object({
        include_addons: Type.Optional(
          Type.Boolean({
            description:
              "If true, also scan res://addons. Default false (addons rarely define project classes).",
          }),
        ),
      }),
      async execute(_id, params) {
        return formatResponse(
          await callBridge(bridge, {
            method: "find_class_name_conflicts",
            include_addons: Boolean(params.include_addons),
          }),
        );
      },
    }),

    defineTool({
      name: "godot_inspect_script",
      label: "Godot inspect script",
      description:
        "Reflect a GDScript (.gd) resource: base class, signals, methods, properties, constants. Read-only; loads the script via ResourceLoader without instantiating it.",
      promptSnippet: "godot_inspect_script: reflect a GDScript's API surface",
      promptGuidelines: [
        "When you need to know which methods/properties/signals a script exposes without reading the .gd source.",
        "Prefer reading the .gd source directly when you need comments / control flow.",
      ],
      parameters: Type.Object({
        path: Type.String({
          description:
            "res:// path to a .gd script, e.g. 'res://player.gd'.",
        }),
      }),
      async execute(_id, params) {
        const path = typeof params.path === "string" ? params.path.trim() : "";
        if (!path) {
          return textResult("path is required.", {
            ok: false,
            error: "missing path",
          });
        }
        const res = await callBridge(bridge, {
          method: "inspect_script",
          path,
        });
        if (!res.ok) {
          return textResult(`Godot RPC error: ${res.error}`, {
            ok: false,
            error: res.error,
          });
        }
        const r = res.result as {
          path?: string;
          base?: string;
          extends?: string;
          signals?: Array<{ name?: string; type?: string }>;
          methods?: Array<{ name?: string; type?: string }>;
          properties?: Array<{ name?: string; type?: string }>;
          constants?: Array<{ name?: string; type?: string }>;
          error?: string;
        };
        if (r.error) {
          return textResult(`inspect_script: ${r.error}`, {
            ok: true,
            result: res.result,
            hasError: true,
          });
        }
        const block = (label: string, items: Array<{ name?: string; type?: string }> | undefined) => {
          if (!items || items.length === 0) return `${label}: (none)`;
          return `${label} (${items.length}):\n` +
            items
              .slice(0, 80)
              .map((m) => `  ${String(m.name ?? "?")}${m.type ? `: ${m.type}` : ""}`)
              .join("\n") +
            (items.length > 80 ? `\n  ... +${items.length - 80} more` : "");
        };
        const text = [
          `inspect_script: ${String(r.path ?? path)}`,
          r.base ? `base=${r.base}` : "",
          r.extends ? `extends=${r.extends}` : "",
          block("signals", r.signals),
          block("properties", r.properties),
          block("methods", r.methods),
          block("constants", r.constants),
        ]
          .filter(Boolean)
          .join("\n");
        return textResult(text, {
          ok: true,
          result: res.result,
          hasError: false,
        });
      },
    }),

    defineTool({
      name: "godot_list_export_presets",
      label: "Godot list export presets",
      description:
        "List every export preset declared in res://export_presets.cfg (name, platform, index). Read-only; no Godot subprocess started.",
      promptSnippet:
        "godot_list_export_presets: enumerate export_presets.cfg",
      promptGuidelines: [
        "Call before godot_export_project to confirm the exact preset name + index the editor expects.",
        "Pairs with godot_check_export_templates to preflight a build.",
      ],
      parameters: emptyParams,
      async execute() {
        return formatResponse(
          await callBridge(bridge, { method: "list_export_presets" }),
        );
      },
    }),

    defineTool({
      name: "godot_check_export_templates",
      label: "Godot check export templates",
      description:
        "Check whether the Godot export templates for the current editor version are installed locally; report missing platforms. Read-only.",
      promptSnippet:
        "godot_check_export_templates: preflight template installation",
      promptGuidelines: [
        "Run before godot_export_project — missing templates fail the export with hard-to-interpret errors.",
        "If missing platforms is non-empty, prompt the user to install templates via Editor → Manage Export Templates.",
      ],
      parameters: emptyParams,
      async execute() {
        const res = await callBridge(bridge, {
          method: "check_export_templates",
        });
        if (!res.ok) {
          return textResult(`Godot RPC error: ${res.error}`, {
            ok: false,
            error: res.error,
          });
        }
        const r = res.result as {
          installed?: boolean;
          version?: string;
          templateVersion?: string;
          missingPlatforms?: string[];
        };
        const missing = Array.isArray(r.missingPlatforms) ? r.missingPlatforms : [];
        const text = r.installed
          ? `Templates installed: editor=${String(r.version ?? "?")}, template=${String(r.templateVersion ?? r.version ?? "?")}.`
          : `Templates NOT installed for editor ${String(r.version ?? "?")}. Missing platforms: ${missing.length === 0 ? "(unknown)" : missing.join(", ")}.`;
        return textResult(text, {
          ok: true,
          result: res.result,
          hasError: !r.installed,
        });
      },
    }),
  ];
}
