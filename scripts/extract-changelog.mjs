#!/usr/bin/env node
/**
 * Extract a version section from CHANGELOG.md for GitHub Release body.
 *
 * Usage:
 *   node scripts/extract-changelog.mjs <version> [--out path] [--fail-empty]
 *
 * Version may be "0.1.3" or "v0.1.3". Matches headings like "## 0.1.3" or "## [0.1.3]".
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DEFAULT_CHANGELOG = join(ROOT, "CHANGELOG.md");

function parseArgs(argv) {
  const args = { version: null, out: null, failEmpty: false, changelog: DEFAULT_CHANGELOG };
  const rest = [...argv];
  while (rest.length) {
    const token = rest.shift();
    if (token === "--out") {
      args.out = rest.shift();
    } else if (token === "--fail-empty") {
      args.failEmpty = true;
    } else if (token === "--changelog") {
      args.changelog = resolve(rest.shift());
    } else if (!token.startsWith("-") && !args.version) {
      args.version = token;
    } else {
      console.error(`Unknown argument: ${token}`);
      process.exit(2);
    }
  }
  return args;
}

function normalizeVersion(raw) {
  if (!raw) return null;
  return String(raw).trim().replace(/^v/i, "");
}

/**
 * @param {string} markdown
 * @param {string} version
 * @returns {string | null}
 */
export function extractChangelogSection(markdown, version) {
  const ver = normalizeVersion(version);
  if (!ver) return null;

  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const headingRe = new RegExp(
    `^##\\s+(?:\\[)?${ver.replace(/\./g, "\\.")}(?:\\])?(?:\\s|$|\\()`,
  );

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const body = lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
  return body.length > 0 ? body : "";
}

function buildReleaseBody(version, section, repoUrl) {
  const ver = normalizeVersion(version);
  const parts = [
    `## X-agent v${ver}`,
    "",
    section || "_（本版本暂无整理后的更新说明）_",
    "",
    "---",
    "",
    `完整变更记录见仓库 [CHANGELOG.md](${repoUrl}/blob/v${ver}/CHANGELOG.md)。`,
  ];
  return parts.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = normalizeVersion(args.version);
  if (!version) {
    console.error(
      "Usage: node scripts/extract-changelog.mjs <version> [--out path] [--fail-empty]",
    );
    process.exit(2);
  }

  const markdown = readFileSync(args.changelog, "utf8");
  const section = extractChangelogSection(markdown, version);

  if (section === null) {
    console.error(
      `CHANGELOG.md 中找不到版本章节 "## ${version}"。请先把 Unreleased 整理进该版本后再发版。`,
    );
    process.exit(1);
  }

  if (args.failEmpty && !section.trim()) {
    console.error(
      `CHANGELOG.md 中 "## ${version}" 章节为空。请补充面向用户的更新说明后再发版。`,
    );
    process.exit(1);
  }

  const repoUrl = "https://github.com/Fromlan/X-agent";
  const body = buildReleaseBody(version, section, repoUrl);

  if (args.out) {
    writeFileSync(resolve(args.out), body, "utf8");
    console.error(`Wrote release notes to ${resolve(args.out)}`);
  } else {
    process.stdout.write(body);
    if (!body.endsWith("\n")) process.stdout.write("\n");
  }
}

const isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main();
}
