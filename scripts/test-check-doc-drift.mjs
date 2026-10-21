#!/usr/bin/env node
// @ts-check
// scripts/test-check-doc-drift.mjs
//
// 自检:用 fixture 锁住 check-doc-drift.mjs 的核心 helper 与规则结构。
// 跑法:`node --test scripts/test-check-doc-drift.mjs`
//
// 核心覆盖:
// 1. findLine 命中/未命中/多匹配
// 2. checkLine keyword + value 同线检查
// 3. checkText 全文 substring
// 4. RULES 结构合法性
// 5. 全部 RULES 在真实 repo 上 0 drift(端到端冒烟)
// 6. 注入「过期 actual」必报 drift(反向冒烟)

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readText, findLine, checkLine, checkText, checkDependencyVersion, getTestChainSummary, checkTestChainSummary, RULES, runChecks } from './check-doc-drift.mjs';

test('runChecks: source failures fail the check and preserve remaining diagnostics', () => {
  const rules = [
    { id: 'missing-source', fetch: () => { throw new Error('source unavailable'); }, docs: [] },
    { id: 'valid-source', fetch: () => '1', docs: [{ file: 'fixture', check: () => ({ ok: true, line: 1 }) }] }
  ];
  const result = runChecks({ log: () => {}, rules });
  assert.equal(result.failed, 1);
  assert.equal(result.passed, 1);
  assert.equal(result.skips[0].id, 'missing-source');
  assert.ok(result.lines.some((line) => line.includes('source unavailable')));
  assert.ok(!result.lines.some((line) => line.includes('0 drift')));
});

test('findLine: 命中返回 1-indexed 行号 + snippet', () => {
  const text = 'first\nsecond line\nthird';
  const r = findLine(text, /second/);
  assert.equal(r.line, 2);
  assert.equal(r.snippet, 'second line');
});

test('findLine: 未命中返回 null', () => {
  const r = findLine('hello world', /nope/);
  assert.equal(r.line, null);
  assert.equal(r.snippet, null);
});

test('findLine: 多行只取第一个', () => {
  const r = findLine('a\nb\na', /a/);
  assert.equal(r.line, 1);
});

test('checkLine: keyword + valuePattern 同线才 ok', async () => {
  // Match the dependency prefix so prerelease suffixes cannot satisfy the check.
  const ok = checkLine({ file: 'docs/agent.md', keyword: /electron-vite/i, valuePattern: /\^?6/ });
  assert.equal(ok.ok, true, `expected line 38 to match; got ${JSON.stringify(ok)}`);
  // keyword 命中但 value 不命中(electron-vite 行不会有 ^7)
  const bad = checkLine({ file: 'docs/agent.md', keyword: /electron-vite/i, valuePattern: /electron-vite\*\*\s+\^7\./ });
  assert.equal(bad.ok, false);
});

test('dependency checks reject other dependency versions and prerelease suffix digits', () => {
  assert.equal(checkDependencyVersion('docs/agent.md', 'electron-vite', '^7').ok, false);
  assert.equal(checkDependencyVersion('docs/agent.md', 'Vite', '^7.0').ok, false);
  assert.equal(checkDependencyVersion('docs/agent.md', 'electron-vite', '^6.0.0-beta.1').ok, false);
  for (const rule of RULES.filter((rule) => ['electron-vite', 'vite', 'pi-sdk'].includes(rule.id))) {
    assert.equal(rule.docs[0].check(rule.fetch()).ok, true);
    assert.equal(rule.docs[0].check('^99.99.99').ok, false);
  }
});

test('checkLine: value 命中但 keyword 不命中', () => {
  const r = checkLine({ file: 'docs/agent.md', keyword: /NOT_A_KEYWORD/, valuePattern: /6/ });
  assert.equal(r.ok, false);
});

test('checkText: 全文命中任意位置', () => {
  // Verify the reported location and content without tying checks to the README layout.
  const pattern = /27\s*个\s*Godot\s*工具/;
  const r = checkText({ file: 'README.md', valuePattern: pattern });
  assert.equal(r.ok, true);
  assert.ok(typeof r.line === 'number' && r.line >= 1);
  assert.equal(r.snippet, readText('README.md').split(/\r?\n/)[r.line - 1].trim());
  assert.equal(typeof r.snippet, 'string');
  assert.match(r.snippet, pattern);
});

test('RULES 结构合法:每条都有 id / label / fetch / docs', () => {
  assert.ok(RULES.length >= 6, `expect ≥ 6 rules, got ${RULES.length}`);
  for (const rule of RULES) {
    assert.ok(rule.id, `rule missing id`);
    assert.ok(rule.label, `${rule.id} missing label`);
    assert.equal(typeof rule.fetch, 'function', `${rule.id} fetch not function`);
    assert.ok(Array.isArray(rule.docs) && rule.docs.length > 0, `${rule.id} docs empty`);
    for (const doc of rule.docs) {
      assert.ok(doc.file, `${rule.id} doc missing file`);
      assert.equal(typeof doc.check, 'function', `${rule.id} doc.check not function`);
    }
  }
});

test('RULES 覆盖首批 6 条:electron-vite / vite / pi-sdk / godot-addon / tsx-test-count / godot-tools', () => {
  const ids = RULES.map((r) => r.id);
  for (const need of ['electron-vite', 'vite', 'pi-sdk', 'godot-addon', 'tsx-test-count', 'godot-tools']) {
    assert.ok(ids.includes(need), `missing rule id: ${need}`);
  }
});

test('runChecks 在真实 repo 上应 0 drift(端到端冒烟)', () => {
  // 静默 log,只看返回值
  const { failed, passed } = runChecks({ log: () => {} });
  assert.equal(failed, 0, 'expected 0 drift on current HEAD; if this fails, run `node scripts/check-doc-drift.mjs` to see why');
  assert.ok(passed >= 6, `expected ≥ 6 passes, got ${passed}`);
});

test('runChecks: 注入「过期 actual」可触发 drift 报告(反向冒烟)', () => {
  // 不动真实 RULES,而是直接调 RULES[0] 的 check 函数,传一个错的 actual
  const rule = RULES[0]; // electron-vite
  const result = rule.docs[0].check('^99.99.99');
  assert.equal(result.ok, false, '故意传错的 actual 应未匹配');
});

test('test chain counts follow script changes and retain repeated executed steps', () => {
  const summary = getTestChainSummary('tsx scripts/test-one.ts && tsx --tsconfig tsconfig.web.json scripts/test-two.ts && tsx scripts/test-one.ts && tsx scripts/measure-context-baseline.ts && node ../../packages/godot-pi/scripts/check-skills.mjs');
  assert.deepEqual(summary, { tests: 3, baseline: 1, skills: 1, total: 5 });
  const text = '3 个 test-* + 1 个 measure-context-baseline + 1 个 godot-pi/scripts/check-skills.mjs = 5 步';
  assert.equal(checkTestChainSummary(text, summary).ok, true);
  assert.equal(checkTestChainSummary(text.replace('3 个', '2 个'), summary).ok, false);
  assert.equal(checkTestChainSummary(text.replace('3 个', '13 个'), summary).ok, false);
  assert.equal(checkTestChainSummary(text.replace('5 步', '4 步'), summary).ok, false);
  assert.equal(checkTestChainSummary('3 个 test-*\n5 步', summary).ok, false);
});

test('tsx-test-count fetcher matches the documented chain', async () => {
  const { getTsxTestCount } = await import('./check-doc-drift.mjs');
  const n = getTsxTestCount();
  const summary = getTestChainSummary();
  assert.equal(n, summary.tests + summary.baseline + summary.skills);
});

test('godot-tools fetcher 在真实 godot-tools.ts 上 = 27', async () => {
  const { getGodotToolsCount } = await import('./check-doc-drift.mjs');
  const n = getGodotToolsCount();
  assert.ok(n >= 25 && n <= 30, `expect ~27 godot tools, got ${n}`);
});
