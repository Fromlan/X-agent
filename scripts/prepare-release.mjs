#!/usr/bin/env node
/**
 * Prepare a desktop release: bump apps/desktop version and verify CHANGELOG.
 *
 * Usage:
 *   node scripts/prepare-release.mjs <version> [--force]
 *
 * Does not commit or push. After success:
 *   1. Review CHANGELOG.md + package.json
 *   2. git add … && git commit -m "release: vX.Y.Z"
 *   3. git tag vX.Y.Z && git push origin HEAD && git push origin vX.Y.Z
 *   4. Wait for .github/workflows/release.yml (authoritative GitHub Release artifacts)
 * Optional smoke before tagging: npm run release:dist (local typecheck + test + exe;
 *   do not commit apps/desktop/release/ — CI rebuilds what users download)
 *
 * Drift protection: by default, refuses to proceed if the current
 * `apps/desktop/package.json` version is greater than the latest existing
 * `vX.Y.Z` tag (i.e. someone prepared a release but forgot to tag). Pass
 * `--force` to bypass in an emergency; the recommended fix is to tag the
 * missing version first:
 *
 *   git tag vX.Y.Z && git push origin vX.Y.Z
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  ensureChangelogSeriesRollup,
  extractChangelogSection,
} from "./extract-changelog.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PKG = join(ROOT, "apps/desktop/package.json");
const LOCK = join(ROOT, "apps/desktop/package-lock.json");
const CHANGELOG = join(ROOT, "CHANGELOG.md");

function normalizeVersion(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/^v/i, "");
}

function compareSemver(a, b) {
  // Returns -1 / 0 / 1. Both args must match the X.Y.Z form.
  const pa = a.split(/[-+]/)[0].split(".").map(Number);
  const pb = b.split(/[-+]/)[0].split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

function latestTag() {
  // `git tag --list 'v*' --sort=-v:refname` works in git 2.7+. If the
  // repo has no tags at all, return null.
  if (!existsSync(join(ROOT, ".git"))) return null;
  try {
    const out = execFileSync(
      "git",
      ["tag", "--list", "v*", "--sort=-v:refname"],
      { cwd: ROOT, encoding: "utf8" },
    ).trim();
    if (!out) return null;
    const first = out.split(/\r?\n/)[0];
    return normalizeVersion(first);
  } catch {
    return null;
  }
}

function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const positional = argv.filter((a) => a !== "--force");
  const version = normalizeVersion(positional[0]);
  if (!version || !/^\d+\.\d+\.\d+([-.][\w.-]+)?$/.test(version)) {
    console.error(
      "Usage: node scripts/prepare-release.mjs <version> [--force]  (e.g. 0.1.3)",
    );
    process.exit(2);
  }

  // Drift check: refuse if package.json is already ahead of the latest tag.
  const currentPkg = JSON.parse(readFileSync(PKG, "utf8"));
  const currentVersion = currentPkg.version;
  const latest = latestTag();
  if (
    latest !== null &&
    normalizeVersion(currentVersion) !== latest &&
    compareSemver(currentVersion, latest) > 0
  ) {
    if (force) {
      console.warn(
        `[drift] WARNING: apps/desktop/package.json is at ${currentVersion} but latest tag is v${latest}. ` +
          `Proceeding because --force was passed.`,
      );
    } else {
      console.error(
        [
          `[drift] Refusing to release v${version}.`,
          ``,
          `  apps/desktop/package.json is at ${currentVersion}`,
          `  latest git tag is                v${latest}`,
          ``,
          `This usually means a previous release was prepared but never tagged.`,
          `Fix the drift first, then re-run:`,
          ``,
          `  git tag v${currentVersion} && git push origin v${currentVersion}`,
          ``,
          `If you really need to bypass (e.g. emergency hotfix), pass --force.`,
        ].join("\n"),
      );
      process.exit(1);
    }
  }

  let changelog = readFileSync(CHANGELOG, "utf8");
  const rolled = ensureChangelogSeriesRollup(changelog, version);
  if (rolled.injected) {
    changelog = rolled.markdown;
    writeFileSync(CHANGELOG, changelog, "utf8");
  }

  const section = extractChangelogSection(changelog, version);
  if (section === null) {
    console.error(
      [
        `缺少 CHANGELOG 章节 "## ${version}"。`,
        "",
        "请先编辑 CHANGELOG.md：",
        `  1. 把 ## Unreleased 下本版本内容挪到新建的 ## ${version}`,
        "  2. 按 功能 / 修复 / 文档 等分组写面向用户的说明",
        "  3. Unreleased 可留空占位",
        "",
        "然后再重新运行本脚本。",
      ].join("\n"),
    );
    process.exit(1);
  }
  if (!section.trim()) {
    console.error(`CHANGELOG "## ${version}" 章节为空，请补充更新说明。`);
    process.exit(1);
  }

  const pkg = currentPkg;
  const prev = pkg.version;
  pkg.version = version;
  writeFileSync(PKG, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

  try {
    const lock = JSON.parse(readFileSync(LOCK, "utf8"));
    lock.version = version;
    if (lock.packages?.[""]) {
      lock.packages[""].version = version;
    }
    writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  } catch (err) {
    console.warn(`Warning: could not sync package-lock.json: ${err.message}`);
  }

  const parsed = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  const isMinorLineStart =
    parsed && Number(parsed[3]) === 0 && Number(parsed[2]) > 0;
  const prevLine = isMinorLineStart
    ? `${parsed[1]}.${Number(parsed[2]) - 1}.x`
    : null;

  console.log(
    [
      `Prepared release v${version} (was ${prev}).`,
      ...(rolled.injected
        ? [`已把 ${prevLine} 累计说明写入 CHANGELOG "## ${version}"。`]
        : []),
      "",
      "CHANGELOG excerpt:",
      section
        .split("\n")
        .slice(0, 40)
        .map((l) => `  ${l}`)
        .join("\n"),
      ...(section.split("\n").length > 40 ? ["  …"] : []),
      "",
      ...(prevLine
        ? [
            `Note: v${version} 为小版本线起点；CHANGELOG / GitHub Release 含 ${prevLine} 各补丁汇总。`,
            `预览：npm run release:notes -- ${version}`,
            "",
          ]
        : []),
      "Next:",
      `  git add CHANGELOG.md apps/desktop/package.json apps/desktop/package-lock.json`,
      `  git commit -m "release: v${version}"`,
      `  git tag v${version}`,
      `  git push origin HEAD && git push origin v${version}`,
      "",
      "Tag push triggers .github/workflows/release.yml：",
      "  - CI 构建并上传 GitHub Releases（安装包 + latest.yml）——用户下载的权威产物",
      "",
      "Optional local smoke（非必须；产物勿提交）：",
      `  npm run release:dist`,
      `    # typecheck + test + electron-builder → apps/desktop/release/`,
      `    # 例如 X-agent-Setup-${version}-x64.exe（仅 NSIS 安装包，不产便携版）`,
      "",
      "Release 正文将使用该 CHANGELOG 章节。",
    ].join("\n"),
  );
}

main();
