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
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const API = "https://gitee.com/api/v5";
const OWNER = process.env.GITEE_OWNER || "fromlan";
const REPO = process.env.GITEE_REPO || "x-agent";
const TOKEN = process.env.GITEE_TOKEN || "";

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

async function gitee(pathname, { method = "GET", query, body, formData } = {}) {
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

  if (formData) {
    if (!formData.has("access_token")) {
      formData.append("access_token", TOKEN);
    }
    init.body = formData;
  } else if (body !== undefined) {
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
  const bytes = readFileSync(filePath);
  const form = new FormData();
  form.append("access_token", TOKEN);
  form.append("file", new Blob([bytes]), name);
  return gitee(`/repos/${OWNER}/${REPO}/releases/${releaseId}/attach_files`, {
    method: "POST",
    formData: form,
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
  files.sort((a, b) => basename(a).localeCompare(basename(b)));
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
    console.log(`  upload ${basename(file)}`);
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
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
