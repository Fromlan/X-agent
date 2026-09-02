#!/usr/bin/env node
/**
 * godot-connector MCP stdio server.
 *
 * Implements the Model Context Protocol (JSON-RPC 2.0 over stdio) by hand
 * using only Node.js stdlib.  Each `tools/call` is forwarded to the local
 * Godot RPC bridge over TCP.  If the bridge is not running, the server
 * lazily spawns it (mirroring `scripts/start-bridge.mjs`) before retrying.
 *
 * The server is intentionally minimal: it implements only the methods used
 * by MiniMax (`initialize`, `tools/list`, `tools/call`, plus the
 * `notifications/initialized` notification).  Adding more capabilities is
 * straightforward but unnecessary today.
 *
 * Reference: https://modelcontextprotocol.io/specification
 */

"use strict";

const { createInterface } = require("node:readline");
const { spawn } = require("node:child_process");
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");

// ESM modules imported lazily so this CommonJS file does not require
// `"type": "module"` in package.json.  We compile to a CJS shape for
// distribution.
const { pathToFileURL } = require("node:url");

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = {
  name: "godot-connector",
  version: "0.1.0",
};
const LAZY_SPAWN_POLL_MS = 500;
const LAZY_SPAWN_TIMEOUT_MS = 5_000;
const RPC_DEFAULT_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 3_000;

// ---------------------------------------------------------------------------
// Lazy ESM bridge-client loader (works under both packaged and unpackaged).
// ---------------------------------------------------------------------------
let bridgeClientModule = null;
let endpointModule = null;
let protocolModule = null;
async function loadHelpers() {
  if (bridgeClientModule && endpointModule && protocolModule) return;
  const here = __dirname;
  // We deliberately import the .mjs files at runtime; Node 22 supports
  // dynamic import of ESM from CJS without a package.json type field.
  const [bc, ep, pr] = await Promise.all([
    import(pathToFileURL(join(here, "scripts", "common", "bridge-client.mjs")).href),
    import(pathToFileURL(join(here, "scripts", "common", "endpoint.mjs")).href),
    import(pathToFileURL(join(here, "scripts", "common", "protocol.mjs")).href),
  ]);
  bridgeClientModule = bc;
  endpointModule = ep;
  protocolModule = pr;
}

// ---------------------------------------------------------------------------
// Tool definitions (1:1 with GODOT_RPC_ALLOWED_METHODS).
// ---------------------------------------------------------------------------
const TOOLS = [
  { name: "godot_ping", method: "ping", description: "Health check against the Godot editor bridge.", inputSchema: { type: "object", additionalProperties: false, properties: {} } },
  { name: "godot_editor_info", method: "get_editor_info", description: "Read Godot editor / project status (version, project path, edited scene, play state).", inputSchema: { type: "object", additionalProperties: false, properties: {} } },
  { name: "godot_open_scenes", method: "get_open_scenes", description: "List the scene tabs currently open in the editor.", inputSchema: { type: "object", additionalProperties: false, properties: {} } },
  { name: "godot_edited_scene", method: "get_edited_scene", description: "Read the current edited scene path and play state.", inputSchema: { type: "object", additionalProperties: false, properties: {} } },
  { name: "godot_open_scene", method: "open_scene", description: "Open a res:// scene path in the editor.", inputSchema: { type: "object", additionalProperties: false, required: ["path"], properties: { path: { type: "string", description: "Scene path (res:// or absolute)." } } } },
  { name: "godot_reload_scene", method: "reload_scene", description: "Reload a scene after disk edits so the editor picks up changes.", inputSchema: { type: "object", additionalProperties: false, required: ["path"], properties: { path: { type: "string", description: "Scene path (res:// or absolute)." } } } },
  { name: "godot_get_scene_tree", method: "get_scene_tree", description: "Read the node tree of a scene without opening it in the editor.", inputSchema: { type: "object", additionalProperties: false, required: ["path"], properties: { path: { type: "string" }, max_depth: { type: "integer", minimum: 0 } } } },
  { name: "godot_get_node_properties", method: "get_node_properties", description: "Read node property descriptors for a node in a scene.", inputSchema: { type: "object", additionalProperties: false, required: ["path", "node_path"], properties: { path: { type: "string" }, node_path: { type: "string" } } } },
  { name: "godot_run_scene", method: "run_current_scene", description: "Play the currently edited scene and collect errors (default ~3s, max 15s).", inputSchema: { type: "object", additionalProperties: false, properties: { wait_ms: { type: "integer", minimum: 0, maximum: 15000 } } } },
  { name: "godot_run_main_scene", method: "play_main_scene", description: "Play the project main scene (F5) and collect errors.", inputSchema: { type: "object", additionalProperties: false, properties: { wait_ms: { type: "integer", minimum: 0, maximum: 15000 } } } },
  { name: "godot_import_resources", method: "import_resources", description: "Scan or reimport assets; pass res:// paths or omit for a full scan.", inputSchema: { type: "object", additionalProperties: false, properties: { paths: { type: "array", items: { type: "string" } } } } },
  { name: "godot_play_errors", method: "get_play_errors", description: "Read buffered play/debugger errors from the latest scene run.", inputSchema: { type: "object", additionalProperties: false, properties: { clear: { type: "boolean" } } } },
  { name: "godot_stop_scene", method: "stop_scene", description: "Stop playing the current scene.", inputSchema: { type: "object", additionalProperties: false, properties: {} } },
  { name: "godot_get_debugger_state", method: "get_debugger_state", description: "Read the editor debugger state (breakpoints, paused status).", inputSchema: { type: "object", additionalProperties: false, properties: {} } },
  { name: "godot_set_breakpoint", method: "set_breakpoint", description: "Add, update, or remove a breakpoint.", inputSchema: { type: "object", additionalProperties: false, required: ["file", "line"], properties: { file: { type: "string" }, line: { type: "integer", minimum: 0 }, condition: { type: "string" }, remove: { type: "boolean" } } } },
  { name: "godot_find_unused_resources", method: "find_unused_resources", description: "Find .tres / texture / audio files not referenced by any scene.", inputSchema: { type: "object", additionalProperties: false, properties: { root: { type: "string" } } } },
  { name: "godot_export_project", method: "export_project", description: "Export the project using a named export preset (5min timeout for big projects).", inputSchema: { type: "object", additionalProperties: false, required: ["preset", "output_dir"], properties: { preset: { type: "string" }, output_dir: { type: "string" }, debug: { type: "boolean" } } } },
  { name: "godot_get_project_setting", method: "get_project_setting", description: "Read a project.godot setting by key.", inputSchema: { type: "object", additionalProperties: false, required: ["key"], properties: { key: { type: "string" } } } },
  { name: "godot_set_project_setting", method: "set_project_setting", description: "Write + save a project.godot setting.", inputSchema: { type: "object", additionalProperties: false, required: ["key", "value"], properties: { key: { type: "string" }, value: {} } } },
  { name: "godot_lint_scripts", method: "lint_scripts", description: "Lint the given GDScript files and return issues by file.", inputSchema: { type: "object", additionalProperties: false, required: ["paths"], properties: { paths: { type: "array", items: { type: "string" } } } } },
  { name: "godot_list_project_files", method: "list_project_files", description: "List project files with optional type/pattern filter and pagination.", inputSchema: { type: "object", additionalProperties: false, properties: { root: { type: "string" }, type: { type: "string" }, pattern: { type: "string" }, limit: { type: "integer", minimum: 1 }, cursor: { type: "string" } } } },
  { name: "godot_resolve_uid", method: "resolve_uid", description: "Resolve a Godot UID to its file path or vice versa.", inputSchema: { type: "object", additionalProperties: false, properties: { uid: { type: "string" }, path: { type: "string" } } } },
  { name: "godot_wait_for_import_done", method: "wait_for_import_done", description: "Block until the given assets finish importing.", inputSchema: { type: "object", additionalProperties: false, required: ["paths"], properties: { paths: { type: "array", items: { type: "string" } }, timeout_ms: { type: "integer", minimum: 0 } } } },
  { name: "godot_list_global_classes", method: "list_global_classes", description: "List all registered global class names in the project.", inputSchema: { type: "object", additionalProperties: false, properties: {} } },
  { name: "godot_find_class_name_conflicts", method: "find_class_name_conflicts", description: "Find global class_name conflicts across project and addons.", inputSchema: { type: "object", additionalProperties: false, properties: { include_addons: { type: "boolean" } } } },
  { name: "godot_inspect_script", method: "inspect_script", description: "Inspect a GDScript: signals, exports, methods, inner classes.", inputSchema: { type: "object", additionalProperties: false, required: ["path"], properties: { path: { type: "string" } } } },
  { name: "godot_list_export_presets", method: "list_export_presets", description: "List all configured export_presets.cfg presets.", inputSchema: { type: "object", additionalProperties: false, properties: {} } },
  { name: "godot_check_export_templates", method: "check_export_templates", description: "Check whether the Godot export templates for the current version are installed.", inputSchema: { type: "object", additionalProperties: false, properties: {} } },
];

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// ---------------------------------------------------------------------------
// JSON-RPC framing.
// ---------------------------------------------------------------------------
let stdinReader = null;
let stdoutWriter = null;
let nextId = 1;

function writeMessage(obj) {
  if (!stdoutWriter) return;
  stdoutWriter.write(JSON.stringify(obj) + "\n");
}

function reply(id, result) {
  writeMessage({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  writeMessage({ jsonrpc: "2.0", id, error: err });
}

// ---------------------------------------------------------------------------
// Tool dispatch.
// ---------------------------------------------------------------------------
async function ensureBridge() {
  await loadHelpers();
  const endpoint = await endpointModule.readEndpoint();
  if (endpoint) {
    const probe = await bridgeClientModule.probeBridge(endpoint, CONNECT_TIMEOUT_MS);
    if (probe) return endpoint;
  }
  // Bridge not reachable — try to spawn it.
  const spawned = await spawnBridge();
  if (!spawned) {
    const err = new Error("godot-connector bridge is not running and could not be started. Check that Node.js 22+ is installed and that no other process is holding the bridge port.");
    err.code = -32000;
    throw err;
  }
  const deadline = Date.now() + LAZY_SPAWN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const ep = await endpointModule.readEndpoint();
    if (ep) {
      const probe = await bridgeClientModule.probeBridge(ep, 500);
      if (probe) return ep;
    }
    await new Promise((r) => setTimeout(r, LAZY_SPAWN_POLL_MS));
  }
  const err = new Error(`godot-connector bridge did not become reachable within ${LAZY_SPAWN_TIMEOUT_MS}ms after spawn.`);
  err.code = -32000;
  throw err;
}

async function spawnBridge() {
  const here = __dirname;
  const entry = join(here, "bridge", "bridge.mjs");
  if (!existsSync(entry)) return null;
  let dataDir;
  try {
    dataDir = endpointModule.pluginDataDir();
  } catch {
    return null;
  }
  try {
    mkdirSync(dataDir, { recursive: true });
  } catch {
    // ignore
  }
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, PLUGIN_DATA: dataDir },
  });
  child.unref();
  if (!child.pid) return null;
  // Write the PID file so subsequent SessionStart hooks know about it.
  try {
    writeFileSync(endpointModule.pidPath(), String(child.pid), "utf8");
  } catch {
    // ignore
  }
  return child.pid;
}

function callPayload(tool, args) {
  // Build the on-the-wire RPC object from the tool name + arguments.  We
  // include only the fields that the addon knows about; extras are silently
  // dropped by the bridge (which does not validate unknown keys).
  const out = { method: tool.method };
  for (const [k, v] of Object.entries(args || {})) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function formatResultBody(res) {
  if (typeof res.result === "string") return res.result;
  return JSON.stringify(res.result, null, 2);
}

async function callTool(name, args) {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) {
    return {
      isError: true,
      content: [
        { type: "text", text: `Unknown tool: ${name}` },
      ],
    };
  }
  const endpoint = await ensureBridge();
  const call = callPayload(tool, args);
  const response = await bridgeClientModule.sendRpc(endpoint, call);
  if (!response) {
    return {
      isError: true,
      content: [
        { type: "text", text: "godot-connector bridge returned no response" },
      ],
    };
  }
  if (response.ok) {
    const body = formatResultBody(response);
    return {
      content: [{ type: "text", text: body }],
      details: {
        ok: true,
        routedTo: response.routedTo,
      },
    };
  }
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `godot-connector RPC error: ${response.error ?? "unknown error"}${response.routedTo ? ` (routed to ${response.routedTo})` : ""}`,
      },
    ],
    details: {
      ok: false,
      error: response.error,
      routedTo: response.routedTo,
    },
  };
}

// ---------------------------------------------------------------------------
// MCP method dispatch.
// ---------------------------------------------------------------------------
async function handleRequest(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize": {
      return reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
    }
    case "ping": {
      return reply(id, {});
    }
    case "tools/list": {
      return reply(id, { tools: TOOLS });
    }
    case "tools/call": {
      const toolName = params && params.name;
      const args = (params && params.arguments) || {};
      try {
        const result = await callTool(toolName, args);
        reply(id, result);
      } catch (err) {
        const code = typeof err?.code === "number" ? err.code : -32000;
        replyError(id, code, err?.message ?? String(err));
      }
      return;
    }
    default:
      replyError(id, -32601, `Method not found: ${method}`);
      return;
  }
}

function handleNotification(msg) {
  // No state-keeping notifications are needed; accept and ignore.
  void msg;
}

function onLine(line) {
  if (!line) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (err) {
    // Per the JSON-RPC 2.0 spec we must not reply to invalid JSON, but MCP
    // clients can tolerate us staying silent.
    return;
  }
  if (typeof msg !== "object" || msg === null) return;
  if (typeof msg.id !== "undefined" && msg.id !== null) {
    void handleRequest(msg);
  } else {
    handleNotification(msg);
  }
}

function start() {
  stdinReader = createInterface({ input: process.stdin, crlfDelay: Infinity });
  stdoutWriter = process.stdout;
  stdinReader.on("line", onLine);
  stdinReader.on("close", () => {
    // Parent closed stdin — exit cleanly.
    process.exit(0);
  });
  process.stdin.on("error", () => {
    // Broken pipe is normal when the parent process exits.
  });
}

start();
