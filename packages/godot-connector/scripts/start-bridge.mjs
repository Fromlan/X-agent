#!/usr/bin/env node
/**
 * SessionStart hook for the godot-connector Plugin.
 *
 * Behaviour:
 *   1. If a healthy bridge is already running (endpoint + port + pid liveness
 *      all pass), exit immediately with no output.
 *   2. Otherwise spawn `bridge.mjs` as a detached background process and
 *      poll the endpoint file for up to 5 seconds.
 *   3. On failure, print a `hookSpecificOutput.additionalContext` JSON to
 *      stdout so the model can mention the issue.  Never exit non-zero — the
 *      MCP server has its own lazy start that can recover.
 *
 * stdin: ignored (we don't need the SessionStart payload to decide).
 * stdout: empty on success, JSON on soft failure.
 * stderr: only used for hard errors (e.g., missing PLUGIN_DATA).
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fsp } from "node:fs";
import { platform } from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { readEndpoint, writePid, clearPid, pluginDataDir, pidPath } from "./common/endpoint.mjs";
import { probeBridge } from "./common/bridge-client.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = process.env.PLUGIN_ROOT || resolve(HERE, "..");
const BRIDGE_ENTRY = join(PLUGIN_ROOT, "bridge", "bridge.mjs");
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 5_000;

function logStderr(message) {
  process.stderr.write(`[start-bridge] ${message}\n`);
}

function emitAdditionalContext(text) {
  const payload = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: text,
    },
  };
  process.stdout.write(JSON.stringify(payload));
}

async function fileExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err && err.code === "ESRCH") return false;
    if (err && err.code === "EPERM") return true;
    return false;
  }
}

async function cleanupStalePid() {
  const pid = await readPidFile();
  if (pid && !(await isProcessAlive(pid))) {
    await clearPid().catch(() => undefined);
  }
}

async function readPidFile() {
  try {
    const text = await fsp.readFile(pidPath(), "utf8");
    const n = Number.parseInt(text.trim(), 10);
    if (Number.isInteger(n) && n > 0) return n;
    return null;
  } catch {
    return null;
  }
}

async function bridgeAlreadyRunning() {
  await cleanupStalePid();
  const pid = await readPidFile();
  const endpoint = await readEndpoint();
  if (!pid || !endpoint) return false;
  if (!(await isProcessAlive(pid))) {
    await clearPid().catch(() => undefined);
    return false;
  }
  const probe = await probeBridge(endpoint, 800);
  return Boolean(probe);
}

async function spawnBridge() {
  if (!existsSync(BRIDGE_ENTRY)) {
    logStderr(`bridge entry not found at ${BRIDGE_ENTRY}`);
    return null;
  }
  const child = spawn(
    process.execPath,
    [BRIDGE_ENTRY],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        PLUGIN_DATA: pluginDataDir(),
      },
    }
  );
  child.unref();
  if (!child.pid) {
    logStderr("spawn returned no pid");
    return null;
  }
  return child.pid;
}

async function waitForEndpoint() {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const endpoint = await readEndpoint();
    if (endpoint) {
      const probe = await probeBridge(endpoint, 500);
      if (probe) return endpoint;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return null;
}

async function main() {
  if (!process.env.PLUGIN_DATA && !process.env.MINIMAX_PLUGIN_DATA) {
    logStderr("PLUGIN_DATA is not set; cannot start bridge");
    emitAdditionalContext(
      "⚠️ godot-connector: PLUGIN_DATA is not set. The MiniMax runtime should inject this environment variable when launching SessionStart hooks. Skipping bridge start."
    );
    return;
  }

  if (await bridgeAlreadyRunning()) {
    // Healthy bridge already up; nothing to do.
    return;
  }

  const pid = await spawnBridge();
  if (!pid) {
    emitAdditionalContext(
      "⚠️ godot-connector: failed to spawn bridge process. Check that Node.js 22+ is installed and on PATH. The MCP server will retry on first tool call."
    );
    return;
  }

  await writePid(pid).catch((err) => logStderr(`write pid failed: ${err.message}`));

  const endpoint = await waitForEndpoint();
  if (!endpoint) {
    emitAdditionalContext(
      `⚠️ godot-connector: bridge process started (pid ${pid}) but did not become reachable within ${POLL_TIMEOUT_MS}ms. The MCP server will retry on first tool call. Check ${pluginDataDir()}/bridge.log for details.`
    );
    return;
  }
  // Success: no output.
}

main().catch((err) => {
  logStderr(`unexpected error: ${err?.stack ?? err}`);
  emitAdditionalContext(
    `⚠️ godot-connector: hook failed with error ${err?.message ?? String(err)}. The MCP server will retry on first tool call.`
  );
  // Exit 0 — never block the session on hook failure.
  process.exit(0);
});

// Avoid the unused-import warning when platform is read for future tweaks.
void platform;
