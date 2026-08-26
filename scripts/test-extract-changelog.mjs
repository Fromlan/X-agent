#!/usr/bin/env node
/**
 * Offline assertions for CHANGELOG extraction / minor-line rollup.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildReleaseBody,
  ensureChangelogSeriesRollup,
  extractChangelogSection,
  formatSeriesAggregate,
  listSeriesSections,
  previousMinorSeries,
} from "./extract-changelog.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE = `# Changelog

## Unreleased

## 0.3.0

### 功能

- next line only

## 0.2.2

### 修复

- patch two

## 0.2.1

### 功能

- patch one

## 0.2.0

### 功能

- line start

## 0.1.1

### 修复

- older line
`;

assert.deepEqual(previousMinorSeries("0.3.0"), { major: 0, minor: 2 });
assert.equal(previousMinorSeries("0.2.6"), null);
assert.equal(previousMinorSeries("1.0.0"), null);
assert.deepEqual(previousMinorSeries("v0.3.0"), { major: 0, minor: 2 });

const series = listSeriesSections(SAMPLE, { major: 0, minor: 2 });
assert.deepEqual(
  series.map((s) => s.version),
  ["0.2.2", "0.2.1", "0.2.0"],
);

const rollup = formatSeriesAggregate(SAMPLE, "0.3.0");
assert.match(rollup, /## 0\.2\.x 累计变更/);
assert.match(rollup, /### 0\.2\.2/);
assert.match(rollup, /### 0\.2\.1/);
assert.match(rollup, /### 0\.2\.0/);
assert.doesNotMatch(rollup, /0\.1\.1/);
assert.equal(formatSeriesAggregate(SAMPLE, "0.2.2"), "");

const section = extractChangelogSection(SAMPLE, "0.3.0");
const withAgg = buildReleaseBody("0.3.0", section, "https://example.com", {
  aggregate: true,
  markdown: SAMPLE,
});
assert.match(withAgg, /next line only/);
assert.match(withAgg, /0\.2\.x 累计变更/);
assert.match(withAgg, /patch two/);

const withoutAgg = buildReleaseBody("0.3.0", section, "https://example.com", {
  aggregate: false,
  markdown: SAMPLE,
});
assert.doesNotMatch(withoutAgg, /0\.2\.x 累计变更/);

const embedded = ensureChangelogSeriesRollup(SAMPLE, "0.3.0");
assert.equal(embedded.injected, true);
const embeddedSection = extractChangelogSection(embedded.markdown, "0.3.0");
assert.match(embeddedSection, /### 0\.2\.x 累计变更/);
assert.match(embeddedSection, /#### 0\.2\.2/);
assert.equal(
  ensureChangelogSeriesRollup(embedded.markdown, "0.3.0").injected,
  false,
);
const noDup = buildReleaseBody(
  "0.3.0",
  embeddedSection,
  "https://example.com",
  { aggregate: true, markdown: embedded.markdown },
);
assert.equal((noDup.match(/0\.2\.x 累计变更/g) || []).length, 1);

// 对真实 CHANGELOG 校验"最新 minor 线起点章节"含上一线累计汇总。
// 早期线起点（如 0.3.0）已被归档进后续 minor 线的汇总段，硬编码断言已失效；
// 动态取最新线起点保证脚本在 CHANGELOG 持续重组时仍可长期通过。
const live = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
const liveVersions = [...live.matchAll(/^## (\d+\.\d+\.\d+)$/gm)].map(
  (m) => m[1],
);
const liveMinorStart = liveVersions.find((v) => v.endsWith(".0"));
assert.ok(liveMinorStart, "CHANGELOG 应至少有一个 minor 线起点章节");
const [liveMajor, liveMinor] = liveMinorStart.split(".").map(Number);
const livePrevLine = `${liveMajor}.${liveMinor - 1}.x`;
const liveSection = extractChangelogSection(live, liveMinorStart);
assert.ok(liveSection, `CHANGELOG 缺少章节 "## ${liveMinorStart}"`);
assert.match(
  liveSection,
  new RegExp(`### ${livePrevLine.replace(/\./g, "\\.")} 累计变更`),
);
// 累计汇总里的子版本以 `#### x.y.z` 形式嵌入 rollup 主体，
// 不要再回退到全 markdown 范围里找 `## x.y.z`（那种"重复段"已被
// 2026-08-26 的 CHANGELOG 整理删掉）。
const rollupBody = liveSection.match(
  new RegExp(
    `### ${livePrevLine.replace(/\./g, "\\.")} 累计变更[\\s\\S]*?(?=\\n### |\\n## |\\Z)`,
  ),
);
assert.ok(rollupBody, `0.5.0 节内找不到 "${livePrevLine}" 累计段`);
const rollupVersions = [
  ...rollupBody[0].matchAll(/^#### (\d+\.\d+\.\d+)$/gm),
].map((m) => m[1]);
assert.ok(
  rollupVersions.length > 0,
  `上一线 ${livePrevLine} 的 rollup 内应有可汇总的小版本章节`,
);
const liveSeries = listSeriesSections(live, {
  major: liveMajor,
  minor: liveMinor - 1,
});
// 兼容旧格式：rollup 之外若还有遗留的 `## x.y.z` 顶级段也算（未清理前）。
const combinedSeries = [
  ...new Set([...rollupVersions, ...liveSeries.map((s) => s.version)]),
].sort((a, b) =>
  b.localeCompare(a, "en", { numeric: true }),
);
assert.ok(
  combinedSeries.length > 0,
  `上一线 ${livePrevLine} 应有可汇总的小版本章节（rollup 内或顶级段）`,
);
assert.match(
  liveSection,
  new RegExp(`#### ${combinedSeries[0].replace(/\./g, "\\.")}`),
);

console.log("test-extract-changelog: ok");
