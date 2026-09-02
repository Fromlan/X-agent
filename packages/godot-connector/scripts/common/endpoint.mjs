/**
 * Read / write the bridge endpoint file.  Format mirrors X-agent's
 * `x-agent-godot-rpc.json` so the addon is byte-compatible, but the file
 * lives under `${PLUGIN_DATA}` so it never collides with X-agent's
 * `~/.pi/agent/x-agent-godot-rpc.json`.
 */

import { promises as fsp } from "node:fs";
import { join } from "node:path";
import {
  ENDPOINT_FILE_VERSION,
  ENDPOINT_TOKEN_RE,
  LOOPBACK_HOSTS,
} from "./protocol.mjs";

const ENDPOINT_FILE_NAME = "bridge-endpoint.json";
const PID_FILE_NAME = "bridge.pid";
const LOG_FILE_NAME = "bridge.log";
const LAST_CLIENT_FILE_NAME = "last-client.json";

export function pluginDataDir() {
  const dir = process.env.PLUGIN_DATA ?? process.env.MINIMAX_PLUGIN_DATA;
  if (!dir) {
    throw new Error(
      "PLUGIN_DATA is not set; this script must be launched by the MiniMax Plugin runtime."
    );
  }
  return dir;
}

export function endpointPath() {
  return join(pluginDataDir(), ENDPOINT_FILE_NAME);
}

export function pidPath() {
  return join(pluginDataDir(), PID_FILE_NAME);
}

export function logPath() {
  return join(pluginDataDir(), LOG_FILE_NAME);
}

export function lastClientPath() {
  return join(pluginDataDir(), LAST_CLIENT_FILE_NAME);
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Validate a parsed endpoint object.  Returns the cleaned object on success,
 * `null` on any validation failure.  The caller is responsible for treating
 * `null` as "fall back to fresh generation".
 */
export function validateEndpoint(raw) {
  if (!isPlainObject(raw)) return null;
  const { host, port, token, version, updatedAt } = raw;
  if (typeof token !== "string" || !ENDPOINT_TOKEN_RE.test(token)) return null;
  if (typeof port !== "number" || !Number.isInteger(port)) return null;
  if (port <= 0 || port >= 65536) return null;
  if (
    host !== undefined &&
    (typeof host !== "string" || !LOOPBACK_HOSTS.has(host))
  ) {
    return null;
  }
  return {
    host: host ?? "127.0.0.1",
    port,
    token,
    version: version === undefined ? ENDPOINT_FILE_VERSION : version,
    updatedAt: typeof updatedAt === "string" ? updatedAt : new Date().toISOString(),
  };
}

export async function readEndpoint() {
  let raw;
  try {
    const text = await fsp.readFile(endpointPath(), "utf8");
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  return validateEndpoint(raw);
}

export async function writeEndpoint(payload) {
  const cleaned = validateEndpoint(payload);
  if (!cleaned) {
    throw new Error("writeEndpoint: payload failed validation");
  }
  // Atomic write: write to .tmp then rename.  Survives mid-write crashes.
  const target = endpointPath();
  const tmp = `${target}.tmp`;
  await fsp.mkdir(pluginDataDir(), { recursive: true });
  await fsp.writeFile(tmp, JSON.stringify(cleaned, null, 2), "utf8");
  await fsp.rename(tmp, target);
  return cleaned;
}

export async function clearEndpoint() {
  try {
    await fsp.unlink(endpointPath());
  } catch (err) {
    if (err && err.code !== "ENOENT") throw err;
  }
}

export async function readPid() {
  try {
    const text = await fsp.readFile(pidPath(), "utf8");
    const n = Number.parseInt(text.trim(), 10);
    if (!Number.isInteger(n) || n <= 0) return null;
    return n;
  } catch {
    return null;
  }
}

export async function writePid(pid) {
  await fsp.mkdir(pluginDataDir(), { recursive: true });
  await fsp.writeFile(pidPath(), String(pid), "utf8");
}

export async function clearPid() {
  try {
    await fsp.unlink(pidPath());
  } catch (err) {
    if (err && err.code !== "ENOENT") throw err;
  }
}

export async function appendLog(line) {
  try {
    await fsp.mkdir(pluginDataDir(), { recursive: true });
    await fsp.appendFile(logPath(), `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch {
    // Logging failures must not break the bridge.
  }
}
