#!/usr/bin/env node
/**
 * Extract a version section from CHANGELOG.md for GitHub Release body.
 *
 * Usage:
 *   node scripts/extract-changelog.mjs <version> [--out path] [--fail-empty] [--no-aggregate]
 *
 * Version may be "0.1.3" or "v0.1.3". Matches headings like "## 0.1.3" or "## [0.1.3]".
 *
 * When releasing a minor-line start (patch === 0 and minor > 0), e.g. 0.3.0, the
 * body also appends an aggregated rollup of the previous line (all ## 0.2.x
 * sections, newest first). Disable with --no-aggregate.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DEFAULT_CHANGELOG = join(ROOT, "CHANGELOG.md");

function parseArgs(argv) {
  const args = {
    version: null,
    out: null,
    failEmpty: false,
    aggregate: true,
    changelog: DEFAULT_CHANGELOG,
  };
  const rest = [...argv];
  while (rest.length) {
    const token = rest.shift();
    if (token === "--out") {
      args.out = rest.shift();
    } else if (token === "--fail-empty") {
      args.failEmpty = true;
    } else if (token === "--no-aggregate") {
      args.aggregate = false;
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

export function normalizeVersion(raw) {
  if (!raw) return null;
  return String(raw).trim().replace(/^v/i, "");
}

/**
 * @param {string} version
 * @returns {{ major: number, minor: number, patch: number, raw: string } | null}
 */
export function parseSemver(version) {
  const ver = normalizeVersion(version);
  if (!ver) return null;
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-.].*)?$/.exec(ver);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    raw: ver,
  };
}

function compareSemverDesc(a, b) {
  if (a.major !== b.major) return b.major - a.major;
  if (a.minor !== b.minor) return b.minor - a.minor;
  return b.patch - a.patch;
}

const HEADING_VERSION_RE = /^##\s+(?:\[)?(\d+\.\d+\.\d+(?:[-.][\w.-]+)?)(?:\])?(?:\s|$|\()/;

/**
 * @param {string} markdown
 * @returns {Array<{ version: string, body: string }>}
 */
export function listChangelogSections(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const sections = [];

  for (let i = 0; i < lines.length; i++) {
    const match = HEADING_VERSION_RE.exec(lines[i]);
    if (!match) continue;

    const version = match[1];
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^##\s+/.test(lines[j])) {
        end = j;
        break;
      }
    }

    const body = lines
      .slice(i + 1, end)
      .join("\n")
      .trim();
    sections.push({ version, body });
    i = end - 1;
  }

  return sections;
}

/**
 * @param {string} markdown
 * @param {string} version
 * @returns {string | null}
 */
export function extractChangelogSection(markdown, version) {
  const ver = normalizeVersion(version);
  if (!ver) return null;

  const found = listChangelogSections(markdown).find((s) => s.version === ver);
  if (!found) return null;
  return found.body.length > 0 ? found.body : "";
}

/**
 * Previous minor line for a line-start release (x.y.0 → x.(y-1).*).
 * Only minor bumps: 0.3.0 → 0.2.*; does not roll up entire previous major on x.0.0.
 *
 * @param {string} version
 * @returns {{ major: number, minor: number } | null}
 */
export function previousMinorSeries(version) {
  const parsed = parseSemver(version);
  if (!parsed) return null;
  if (parsed.patch !== 0) return null;
  if (parsed.minor <= 0) return null;
  return { major: parsed.major, minor: parsed.minor - 1 };
}

/**
 * @param {string} markdown
 * @param {{ major: number, minor: number }} series
 * @returns {Array<{ version: string, body: string }>}
 */
export function listSeriesSections(markdown, series) {
  return listChangelogSections(markdown)
    .map((s) => ({ ...s, parsed: parseSemver(s.version) }))
    .filter(
      (s) =>
        s.parsed &&
        s.parsed.major === series.major &&
        s.parsed.minor === series.minor,
    )
    .sort((a, b) => compareSemverDesc(a.parsed, b.parsed))
    .map(({ version, body }) => ({ version, body }));
}

/**
 * @param {string} markdown
 * @param {string} version
 * @returns {string}
 */
export function formatSeriesAggregate(markdown, version) {
  const series = previousMinorSeries(version);
  if (!series) return "";

  const sections = listSeriesSections(markdown, series).filter((s) =>
    s.body.trim(),
  );
  if (sections.length === 0) return "";

  const label = `${series.major}.${series.minor}.x`;
  const parts = [
    `## ${label} 累计变更`,
    "",
    `以下为 ${series.major}.${series.minor}.0 起各小版本面向用户的说明汇总（新→旧）。`,
    "",
  ];

  for (const section of sections) {
    parts.push(`### ${section.version}`, "", section.body, "");
  }

  return parts.join("\n").trim();
}

export function buildReleaseBody(version, section, repoUrl, options = {}) {
  const ver = normalizeVersion(version);
  const aggregate = options.aggregate !== false;
  const markdown = options.markdown ?? "";

  const parts = [
    `## X-agent v${ver}`,
    "",
    section || "_（本版本暂无整理后的更新说明）_",
    "",
  ];

  if (aggregate && markdown) {
    const rollup = formatSeriesAggregate(markdown, ver);
    if (rollup) {
      parts.push("---", "", rollup, "");
    }
  }

  parts.push(
    "---",
    "",
    `完整变更记录见仓库 [CHANGELOG.md](${repoUrl}/blob/v${ver}/CHANGELOG.md)。`,
  );
  return parts.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = normalizeVersion(args.version);
  if (!version) {
    console.error(
      "Usage: node scripts/extract-changelog.mjs <version> [--out path] [--fail-empty] [--no-aggregate]",
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
  const body = buildReleaseBody(version, section, repoUrl, {
    aggregate: args.aggregate,
    markdown,
  });

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
