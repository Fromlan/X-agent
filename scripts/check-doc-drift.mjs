#!/usr/bin/env node
// @ts-check
// scripts/check-doc-drift.mjs
//
// 轻量文档漂移自检:把文档里最容易过期的硬数字(版本号、工具数、测试脚本数、
// Godot addon 版本)与代码源对账,不一致即非 0 退出。CI 在 lint 之后跑一次。
//
// 零依赖,Node 24 原生,git 状态零修改,只读。
//
// 跑法:`node scripts/check-doc-drift.mjs`(本仓库 `npm run doc:drift` 转发)
//
// 首批规则对应 docs 与代码不一致清单 D1–D5、D11–D14;新增规则只需在
// `RULES` 数组加 1 条 + 在对应文档更新一行,无需改 CI。
//
// 自检:`node scripts/test-check-doc-drift.mjs`(imports the helpers from this file)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

// ─── IO helpers ───────────────────────────────────────────────────────────────

export function readText(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8');
}

export function readJson(relPath) {
  return JSON.parse(readText(relPath));
}

/**
 * 找文本里第一个匹配 regex 的 1-indexed 行号;未匹配返回 { line: null }。
 */
export function findLine(text, regex) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) return { line: i + 1, snippet: lines[i].trim() };
  }
  return { line: null, snippet: null };
}

// ─── 实际值抓取(fetcher) ─────────────────────────────────────────────────────

export function getElectronViteVersion() {
  return readJson('apps/desktop/package.json').devDependencies['electron-vite'];
}

export function getViteVersion() {
  return readJson('apps/desktop/package.json').devDependencies['vite'];
}

export function getPiSdkVersion() {
  return readJson('apps/desktop/package.json').dependencies['@earendil-works/pi-coding-agent'];
}

export function getGodotAddonVersion() {
  const cfg = readText('packages/godot-editor-rpc/addons/x_agent_rpc/plugin.cfg');
  const m = cfg.match(/^version\s*=\s*"([^"]+)"\s*$/m);
  if (!m) throw new Error('plugin.cfg 缺 version 行');
  return m[1];
}

export function getTsxTestCount() {
  return getTestChainSummary().total;
}

/** Count executed test steps from the package script, including repeated commands. */
export function getTestChainSummary(testScript = readJson('apps/desktop/package.json').scripts.test) {
  const commands = testScript.split(/\s*&&\s*/).filter((command) => command.trim());
  return {
    tests: commands.filter((command) => /\bscripts\/test-[\w-]+\.[mc]?ts\b/.test(command)).length,
    baseline: commands.filter((command) => /\bscripts\/measure-context-baseline\.ts\b/.test(command)).length,
    skills: commands.filter((command) => /\/check-skills\.mjs\b/.test(command)).length,
    total: commands.length,
  };
}

/** Require every documented test count to match the same authoritative chain. */
export function checkTestChainSummary(text, summary) {
  const pattern = new RegExp(`(?<!\\d)${summary.tests}\\s*个\\s*test-\\*\\s*\\+\\s*${summary.baseline}\\s*个\\s*measure-context-baseline\\s*\\+\\s*${summary.skills}\\s*个\\s*godot-pi/scripts/check-skills\\.mjs\\s*=\\s*${summary.total}\\s*步`);
  const result = findLine(text, pattern);
  return { ok: result.line !== null, ...result };
}

export function getGodotToolsCount() {
  const ts = readText('apps/desktop/electron/agent/godot-tools.ts');
  const matches = ts.matchAll(/name:\s*"godot_[a-z_]+"/g);
  return new Set([...matches].map((m) => m[0])).size;
}

// ─── 文档侧 pattern 检查 ──────────────────────────────────────────────────────

/**
 * 行级检查:整行同时匹配 keyword 与 valuePattern 才算 ok。
 * 用于版本号类(同一行内 keyword 紧邻版本)。
 */
export function checkLine({ file, keyword, valuePattern }) {
  const text = readText(file);
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (keyword.test(line) && valuePattern.test(line)) {
      return { ok: true, line: i + 1, snippet: line };
    }
  }
  return { ok: false };
}

/**
 * 全文检查:任意位置匹配 valuePattern 即算 ok(给段落用,如 godot 工具数 "27 个")。
 */
export function checkText({ file, valuePattern }) {
  const text = readText(file);
  const result = findLine(text, valuePattern);
  return { ok: result.line !== null, line: result.line, snippet: result.snippet };
}

/** Match the dependency's own declared version, rather than another number on its line. */
export function checkDependencyVersion(file, name, version) {
  const escape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return checkLine({
    file,
    keyword: new RegExp(escape(name)),
    valuePattern: new RegExp(`${escape(name)}(?:\\*\\*)?\\s+${escape(version)}(?=\\s|[；;（]|$)`),
  });
}

// ─── Rules ────────────────────────────────────────────────────────────────────

export const RULES = [
  {
    id: 'electron-vite',
    label: 'electron-vite version',
    fetch: getElectronViteVersion,
    docs: [
      { file: 'docs/agent.md', check: (actual) => {
        return checkDependencyVersion('docs/agent.md', 'electron-vite', actual);
      } }
    ]
  },
  {
    id: 'vite',
    label: 'vite version',
    fetch: getViteVersion,
    docs: [
      { file: 'docs/agent.md', check: (actual) => {
        return checkDependencyVersion('docs/agent.md', 'Vite', actual);
      } }
    ]
  },
  {
    id: 'pi-sdk',
    label: '@earendil-works/pi-coding-agent version',
    fetch: getPiSdkVersion,
    docs: [
      { file: 'docs/agent.md', check: (actual) => {
        return checkDependencyVersion('docs/agent.md', '@earendil-works/pi-coding-agent', actual);
      } }
    ]
  },
  {
    id: 'godot-addon',
    label: 'Godot addon version',
    fetch: getGodotAddonVersion,
    docs: [
      { file: 'AGENTS.md', check: (actual) => {
        const v = String(actual);
        return checkText({ file: 'AGENTS.md', valuePattern: new RegExp(v.replace(/\./g, '\\.').replace(/-/g, '\\-')) });
      } },
      { file: 'CLAUDE.md', check: (actual) => {
        const v = String(actual);
        return checkText({ file: 'CLAUDE.md', valuePattern: new RegExp(v.replace(/\./g, '\\.').replace(/-/g, '\\-')) });
      } }
    ]
  },
  {
    id: 'tsx-test-count',
    label: 'npm test 串联条目数',
    fetch: getTestChainSummary,
    docs: [
      { file: 'AGENTS.md', check: (actual) => {
        return checkTestChainSummary(readText('AGENTS.md'), actual);
      } },
      { file: 'docs/agent.md', check: (actual) => {
        return checkTestChainSummary(readText('docs/agent.md'), actual);
      } }
    ]
  },
  {
    id: 'godot-tools',
    label: 'godot-tools defineTool 数量',
    fetch: getGodotToolsCount,
    docs: [
      { file: 'README.md', check: (actual) => {
        const n = Number(actual);
        return checkText({ file: 'README.md', valuePattern: new RegExp(`\\*\\*${n}\\s*个\\s*Godot\\s*工具\\*\\*`) });
      } },
      { file: 'README.en.md', check: (actual) => {
        const n = Number(actual);
        return checkText({ file: 'README.en.md', valuePattern: new RegExp(`\\*\\*${n}\\s*Godot\\s*tools\\*\\*`) });
      } }
    ]
  }
];

// ─── 跑 ───────────────────────────────────────────────────────────────────────

/** Run every rule and fail closed when its authoritative source cannot be read. */
export function runChecks({ log = console.log, rules = RULES } = {}) {
  let failed = 0;
  let passed = 0;
  const skips = [];
  const lines = [];

  lines.push(`🔎 doc:drift ${rules.length} rules\n`);

  for (const rule of rules) {
    let actual;
    try {
      actual = rule.fetch();
    } catch (e) {
      failed++;
      skips.push({ id: rule.id, error: e.message });
      lines.push(`❌ ${rule.id}  source check failed: ${e.message}`);
      continue;
    }
    let ruleFailed = 0;
    for (const doc of rule.docs) {
      const result = doc.check(actual);
      if (result.ok) {
        passed++;
        lines.push(`✅ ${rule.id}  ${typeof actual === 'object' ? JSON.stringify(actual) : actual}  ok  (${doc.file}:${result.line})`);
      } else {
        failed++;
        ruleFailed++;
        lines.push(`❌ [${rule.id}] ${doc.file}  实际 ${typeof actual === 'object' ? JSON.stringify(actual) : actual}, 文档未匹配`);
      }
    }
    if (ruleFailed > 0) lines.push('');
  }

  lines.push('');
  if (failed > 0) {
    lines.push(`❌ doc:drift  ${failed} drift, ${passed} ok`);
  } else {
    lines.push(`✅ doc:drift 0 drift, ${passed} ok${skips.length ? ' (' + skips.length + ' skipped)' : ''}`);
  }

  for (const line of lines) log(line);
  return { failed, passed, skips, lines };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { failed } = runChecks();
  process.exit(failed > 0 ? 1 : 0);
}
