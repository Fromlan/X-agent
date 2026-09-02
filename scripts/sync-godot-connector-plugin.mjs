#!/usr/bin/env node
/**
 * Sync the source-of-truth `packages/godot-connector/` Plugin into the
 * MiniMax local Plugin install directory (`~/.minimax/plugins/godot-connector/`).
 *
 * Use after editing files under `packages/godot-connector/` so MiniMax Code
 * picks up the changes on its next rescan.
 *
 *   node scripts/sync-godot-connector-plugin.mjs
 *
 * Exits 0 on success, 1 on failure.
 */

import { promises as fsp, existsSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SOURCE = join(REPO_ROOT, "packages", "godot-connector");
const PLUGIN_NAME = "godot-connector";

function targetDir() {
  const override = process.env.MINIMAX_PLUGINS_DIR;
  if (override) return override;
  return join(homedir(), ".minimax", "plugins", PLUGIN_NAME);
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function* walkFiles(root) {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else if (entry.isFile()) {
      yield full;
    } else {
      throw new Error(`unsupported entry: ${full} (symlinks / sockets / etc. are not allowed in a Plugin)`);
    }
  }
}

async function snapshot(root) {
  const out = new Map();
  for await (const file of walkFiles(root)) {
    const rel = relative(root, file).replace(/\\/g, "/");
    const buf = await fsp.readFile(file);
    out.set(rel, sha256(buf));
  }
  return out;
}

async function main() {
  if (!existsSync(SOURCE)) {
    process.stderr.write(`source not found: ${SOURCE}\n`);
    process.exit(1);
  }
  const target = targetDir();
  process.stdout.write(`source: ${SOURCE}\ntarget: ${target}\n`);

  // 1. Snapshot source.
  const srcSnap = await snapshot(SOURCE);

  // 2. If target exists, ensure no symlinks (MiniMax Plugin V1 rejects them).
  if (existsSync(target)) {
    const targetStat = await fsp.lstat(target);
    if (targetStat.isSymbolicLink()) {
      process.stderr.write(`refusing to overwrite symlink at ${target}\n`);
      process.exit(1);
    }
    const targetSnap = await snapshot(target);
    const onlyInTarget = [...targetSnap.keys()].filter((k) => !srcSnap.has(k));
    if (onlyInTarget.length > 0) {
      process.stdout.write(
        `note: ${onlyInTarget.length} file(s) only in target (runtime state, will be kept):\n`
      );
      for (const k of onlyInTarget.slice(0, 10)) process.stdout.write(`  - ${k}\n`);
      if (onlyInTarget.length > 10) {
        process.stdout.write(`  ... and ${onlyInTarget.length - 10} more\n`);
      }
    }
  } else {
    await fsp.mkdir(target, { recursive: true });
  }

  // 3. Copy every source file, creating parent directories as needed.
  let copied = 0;
  for (const rel of srcSnap.keys()) {
    const srcFile = join(SOURCE, rel);
    const dstFile = join(target, rel);
    await fsp.mkdir(dirname(dstFile), { recursive: true });
    await fsp.copyFile(srcFile, dstFile);
    copied++;
  }
  process.stdout.write(`copied ${copied} file(s) to ${target}\n`);

  // 4. Verify byte-identity for files that exist in both.
  let verified = 0;
  for (const [rel, srcHash] of srcSnap) {
    const dstFile = join(target, rel);
    if (!existsSync(dstFile)) {
      process.stderr.write(`missing after copy: ${rel}\n`);
      process.exit(1);
    }
    const dstHash = sha256(await fsp.readFile(dstFile));
    if (dstHash !== srcHash) {
      process.stderr.write(`hash mismatch after copy: ${rel}\n`);
      process.exit(1);
    }
    verified++;
  }
  process.stdout.write(`verified ${verified} file(s) byte-identical\n`);
  process.stdout.write(`OK — MiniMax will pick up the change on its next local-plugin rescan.\n`);
}

main().catch((err) => {
  process.stderr.write(`sync failed: ${err?.stack ?? err}\n`);
  process.exit(1);
});
