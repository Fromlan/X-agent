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

// Real changelog: previewing a fictional 0.3.0 still rolls up live 0.2.x notes.
const live = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
const liveRollup = formatSeriesAggregate(live, "0.3.0");
assert.match(liveRollup, /## 0\.2\.x 累计变更/);
assert.match(liveRollup, /### 0\.2\.6/);
assert.match(liveRollup, /### 0\.2\.0/);

console.log("test-extract-changelog: ok");
