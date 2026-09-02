#!/usr/bin/env node
/**
 * Gracefully stop the godot-connector bridge.  Reads `${PLUGIN_DATA}/bridge.pid`
 * and sends SIGTERM, then SIGKILL after 3 seconds if still alive.
 *
 * Exit codes:
 *   0  – bridge stopped (or no bridge was running)
 *   1  – error reading state files
 */

import { promises as fsp } from "node:fs";
import { pidPath, pluginDataDir, clearEndpoint, clearPid, appendLog } from "../scripts/common/endpoint.mjs";

const GRACE_MS = 3_000;

async function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err && err.code === "ESRCH") return false;
    // EPERM means the process exists but we can't signal it; treat as alive.
    if (err && err.code === "EPERM") return true;
    return false;
  }
}

async function main() {
  let pid;
  try {
    const text = await fsp.readFile(pidPath(), "utf8");
    pid = Number.parseInt(text.trim(), 10);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      // Nothing to stop.
      await clearEndpoint().catch(() => undefined);
      return;
    }
    process.stderr.write(`failed to read pid file: ${err.message}\n`);
    process.exit(1);
  }

  if (!Number.isInteger(pid) || pid <= 0) {
    await clearPid().catch(() => undefined);
    return;
  }

  if (!isAlive(pid)) {
    await appendLog(`stop-bridge: pid ${pid} not alive, cleaning state`);
    await clearPid().catch(() => undefined);
    await clearEndpoint().catch(() => undefined);
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    process.stderr.write(`SIGTERM failed for pid ${pid}: ${err.message}\n`);
  }

  const start = Date.now();
  while (Date.now() - start < GRACE_MS) {
    if (!isAlive(pid)) {
      await clearPid().catch(() => undefined);
      await clearEndpoint().catch(() => undefined);
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch (err) {
    process.stderr.write(`SIGKILL failed for pid ${pid}: ${err.message}\n`);
  }
  await clearPid().catch(() => undefined);
  await clearEndpoint().catch(() => undefined);
}

main().catch((err) => {
  process.stderr.write(`stop-bridge error: ${err?.stack ?? err}\n`);
  process.exit(1);
});

// Ensure pluginDataDir() can be resolved even when PLUGIN_DATA is empty.
void pluginDataDir;
