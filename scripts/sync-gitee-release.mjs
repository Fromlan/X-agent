#!/usr/bin/env node
/**
 * Sync electron-builder release artifacts to Gitee Releases.
 *
 * Uploads the same files to:
 *   1) versioned tag  v{version}
 *   2) rolling tag    latest   (generic feed base for electron-updater)
 *
 * Usage:
 *   node scripts/sync-gitee-release.mjs <version> [artifactsDir]
 *
 * Env:
 *   GITEE_TOKEN   required — personal access token with projects scope
 *   GITEE_OWNER   optional — default fromlan
 *   GITEE_REPO    optional — default x-agent
 *   GITEE_TARGET  optional — target_commitish (default: repo default_branch)
 *   GITEE_UPLOAD_ATTEMPTS  optional — default 5
 *
 * Large attach uploads use curl (30min max-time + retries). Plain fetch/undici
 * defaults abort ~100MB bodies around 300s, which failed v0.3.2 on CI.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const API = "https://gitee.com/api/v5";
const OWNER = process.env.GITEE_OWNER || "fromlan";
const REPO = process.env.GITEE_REPO || "x-agent";
const TOKEN = process.env.GITEE_TOKEN || "";
const UPLOAD_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.GITEE_UPLOAD_ATTEMPTS || "5", 10) || 5,
);

function usage() {
  console.error(
    "Usage: node scripts/sync-gitee-release.mjs <version> [artifactsDir]",
  );
  process.exit(2);
}

function normalizeVersion(raw) {
  const v = String(raw || "").trim().replace(/^v/i, "");
  if (!/^\d+\.\d+\.\d+/.test(v)) {
    throw new Error(`Invalid version: ${raw}`);
  }
  return v;
}

function formatError(err) {
  if (!(err instanceof Error)) return String(err);
  const parts = [err.message];
  let cause = err.cause;
  let depth = 0;
  while (cause && depth < 4) {
    if (cause instanceof Error) {
      parts.push(`cause: ${cause.message}`);
      cause = cause.cause;
    } else {
      parts.push(`cause: ${String(cause)}`);
      break;
    }
    depth += 1;
  }
  return parts.join(" | ");
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function isRetryableUploadError(err) {
  const text = formatError(err).toLowerCase();
  return (
    /fetch failed|curl |econnreset|etimedout|econnrefused|socket|network|timeout|aborted|UND_ERR|5\d\d\b|28\b|exit 2[28]\b/.test(
      text,
    )
  );
}

async function withRetry(label, fn, { attempts = UPLOAD_ATTEMPTS } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const detail = formatError(err);
      console.error(`  ${label} failed (attempt ${i}/${attempts}): ${detail}`);
      if (i >= attempts || !isRetryableUploadError(err)) {
        throw err;
      }
      const waitMs = Math.min(60_000, 3000 * 2 ** (i - 1));
      console.log(`  retrying in ${Math.round(waitMs / 1000)}s…`);
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

async function gitee(pathname, { method = "GET", query, body } = {}) {
  const url = new URL(`${API}${pathname}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }
  if (method === "GET" || method === "DELETE") {
    url.searchParams.set("access_token", TOKEN);
  }

  /** @type {RequestInit} */
  const init = { method, headers: {} };

  if (body !== undefined) {
    const params = new URLSearchParams();
    params.set("access_token", TOKEN);
    for (const [k, v] of Object.entries(body)) {
      if (v != null) params.set(k, String(v));
    }
    init.headers = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    init.body = params.toString();
  }

  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg =
      (json && (json.message || json.error_description || json.error)) ||
      text ||
      res.statusText;
    throw new Error(`${method} ${pathname} → ${res.status}: ${msg}`);
  }
  return json;
}

function runCurl(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("curl", args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      const detail = (stderr || stdout || "").trim() || `curl exit ${code}`;
      reject(new Error(`curl failed (exit ${code}): ${detail}`));
    });
  });
}

async function getRepo() {
  return gitee(`/repos/${OWNER}/${REPO}`);
}

async function findReleaseByTag(tag) {
  try {
    return await gitee(`/repos/${OWNER}/${REPO}/releases/tags/${encodeURIComponent(tag)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/\b404\b/.test(message)) return null;
    throw err;
  }
}

async function listAttachFiles(releaseId) {
  try {
    const list = await gitee(
      `/repos/${OWNER}/${REPO}/releases/${releaseId}/attach_files`,
    );
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function deleteAttachFile(releaseId, attachFileId) {
  await gitee(
    `/repos/${OWNER}/${REPO}/releases/${releaseId}/attach_files/${attachFileId}`,
    { method: "DELETE" },
  );
}

async function deleteRelease(releaseId) {
  await gitee(`/repos/${OWNER}/${REPO}/releases/${releaseId}`, {
    method: "DELETE",
  });
}

async function createRelease({ tag, name, body, targetCommitish }) {
  return gitee(`/repos/${OWNER}/${REPO}/releases`, {
    method: "POST",
    body: {
      tag_name: tag,
      name,
      body: body || "",
      target_commitish: targetCommitish,
    },
  });
}

async function uploadAttach(releaseId, filePath) {
  const name = basename(filePath);
  const sizeMb = (statSync(filePath).size / (1024 * 1024)).toFixed(1);
  const url = `${API}/repos/${OWNER}/${REPO}/releases/${releaseId}/attach_files`;
  // Streaming multipart via curl — avoids undici's ~300s bodyTimeout on ~100MB exes.
  await withRetry(`upload ${name} (${sizeMb} MB)`, async () => {
    const { stdout } = await runCurl([
      "-sS",
      "-f",
      "-X",
      "POST",
      url,
      "-F",
      `access_token=${TOKEN}`,
      "-F",
      `file=@${filePath};filename=${name}`,
      "--connect-timeout",
      "60",
      "--max-time",
      "1800",
      "--retry",
      "0",
    ]);
    if (stdout.trim()) {
      try {
        const json = JSON.parse(stdout);
        if (json?.message && !json?.id && !json?.name) {
          throw new Error(json.message);
        }
      } catch (err) {
        if (err instanceof SyntaxError) {
          // Some Gitee responses may be empty or non-JSON on success.
          return;
        }
        throw err;
      }
    }
  });
}

function collectArtifacts(dir) {
  const names = readdirSync(dir);
  const files = [];
  for (const name of names) {
    if (!/\.(exe|blockmap|yml|yaml)$/i.test(name)) continue;
    const full = join(dir, name);
    if (!statSync(full).isFile()) continue;
    files.push(full);
  }
  // Small metadata first; large installers last (longer upload + retries).
  files.sort((a, b) => {
    const sizeDiff = statSync(a).size - statSync(b).size;
    if (sizeDiff !== 0) return sizeDiff;
    return basename(a).localeCompare(basename(b));
  });
  return files;
}

async function ensureCleanRelease({ tag, name, body, targetCommitish }) {
  const existing = await findReleaseByTag(tag);
  if (existing?.id) {
    const attaches = await listAttachFiles(existing.id);
    for (const file of attaches) {
      if (file?.id != null) {
        console.log(`  delete attach ${file.name || file.id}`);
        await deleteAttachFile(existing.id, file.id);
      }
    }
    // Recreate so tag/name/body stay consistent (esp. rolling `latest`).
    console.log(`  delete release ${tag} (id=${existing.id})`);
    await deleteRelease(existing.id);
  }
  console.log(`  create release ${tag}`);
  return createRelease({ tag, name, body, targetCommitish });
}

async function uploadAll(releaseId, files) {
  for (const file of files) {
    const sizeMb = (statSync(file).size / (1024 * 1024)).toFixed(1);
    console.log(`  upload ${basename(file)} (${sizeMb} MB)`);
    await uploadAttach(releaseId, file);
  }
}

async function main() {
  const versionArg = process.argv[2];
  if (!versionArg) usage();
  if (!TOKEN) {
    console.error("GITEE_TOKEN is required");
    process.exit(1);
  }

  const version = normalizeVersion(versionArg);
  const tag = `v${version}`;
  const artifactsDir = resolve(
    process.argv[3] || join("apps", "desktop", "release"),
  );

  if (!existsSync(artifactsDir)) {
    throw new Error(`Artifacts dir not found: ${artifactsDir}`);
  }
  const files = collectArtifacts(artifactsDir);
  if (files.length === 0) {
    throw new Error(`No release artifacts in ${artifactsDir}`);
  }

  console.log(`Gitee sync → ${OWNER}/${REPO}`);
  console.log(`Artifacts (${files.length}): ${artifactsDir}`);

  const repo = await getRepo();
  const targetCommitish =
    process.env.GITEE_TARGET ||
    repo?.default_branch ||
    "master";
  if (!repo?.default_branch) {
    console.warn(
      "Warning: repo has no default_branch; ensure the Gitee repo has at least one commit.",
    );
  }
  console.log(`target_commitish=${targetCommitish}`);

  const notesPath = process.env.GITEE_NOTES_FILE;
  const body = notesPath && existsSync(notesPath)
    ? readFileSync(notesPath, "utf8")
    : `X-agent ${tag}`;

  console.log(`\n[1/2] Versioned release ${tag}`);
  const versioned = await ensureCleanRelease({
    tag,
    name: `X-agent ${tag}`,
    body,
    targetCommitish,
  });
  await uploadAll(versioned.id, files);

  console.log(`\n[2/2] Rolling release latest`);
  const latest = await ensureCleanRelease({
    tag: "latest",
    name: `X-agent latest (${tag})`,
    body: `Mirrors ${tag} for electron-updater generic feed.\n\n${body}`,
    targetCommitish,
  });
  await uploadAll(latest.id, files);

  console.log(
    `\nDone. Feed URL: https://gitee.com/${OWNER}/${REPO}/releases/download/latest/`,
  );
}

main().catch((err) => {
  console.error(formatError(err));
  process.exit(1);
});
