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
  const testScript = readJson('apps/desktop/package.json').scripts.test;
  // 抓 `tsx ... scripts/<name>.<ext>` 与 `node ... check-skills.mjs` 的去重条目
  const matches = testScript.matchAll(/(?:tsx(?:\s+--tsconfig\s+\S+)?\s+scripts\/[a-zA-Z0-9-]+\.[mc]?ts|node\s+[^\s|;&]+\/check-skills\.mjs)/g);
  const uniq = new Set();
  for (const m of matches) uniq.add(m[0].replace(/\s+/g, ' ').trim());
  return uniq.size;
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

// ─── Rules ────────────────────────────────────────────────────────────────────

export const RULES = [
  {
    id: 'electron-vite',
    label: 'electron-vite major',
    fetch: getElectronViteVersion,
    docs: [
      { file: 'docs/agent.md', check: (actual) => {
        const major = String(actual).replace(/^\^?(\d+).*/, '$1');
        return checkLine({ file: 'docs/agent.md', keyword: /electron-vite/i, valuePattern: new RegExp(`\\^?${major}`) });
      } }
    ]
  },
  {
    id: 'vite',
    label: 'vite major',
    fetch: getViteVersion,
    docs: [
      { file: 'docs/agent.md', check: (actual) => {
        const major = String(actual).replace(/^\^?(\d+).*/, '$1');
        return checkLine({ file: 'docs/agent.md', keyword: /\bVite\b/, valuePattern: new RegExp(`\\^?${major}`) });
      } }
    ]
  },
  {
    id: 'pi-sdk',
    label: '@earendil-works/pi-coding-agent version',
    fetch: getPiSdkVersion,
    docs: [
      { file: 'docs/agent.md', check: (actual) => {
        const minorMinor = String(actual).replace(/^\^?(\d+\.\d+).*/, '$1');
        return checkLine({ file: 'docs/agent.md', keyword: /pi-coding-agent/, valuePattern: new RegExp(minorMinor.replace('.', '\\.')) });
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
    fetch: getTsxTestCount,
    docs: [
      { file: 'AGENTS.md', check: (actual) => {
        const n = Number(actual);
        // 文档中 "60 个 test-*" + "62 步" 两处都应出现
        const text = readText('AGENTS.md');
        const has60 = /60\s*个\s*test-/.test(text);
        const has62 = new RegExp(`${n}\\s*步`).test(text);
        return { ok: has60 && has62, line: has60 ? findLine(text, /60\s*个\s*test-/).line : null, snippet: has60 ? 'has 60 + has 62' : 'missing one' };
      } },
      { file: 'docs/agent.md', check: (actual) => {
        const n = Number(actual);
        const text = readText('docs/agent.md');
        const has60 = /60\s*个\s*test-/.test(text);
        const has62 = new RegExp(`${n}\\s*步`).test(text);
        return { ok: has60 && has62, line: has60 ? findLine(text, /60\s*个\s*test-/).line : null, snippet: has60 ? 'has 60 + has 62' : 'missing one' };
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

export function runChecks({ log = console.log } = {}) {
  let failed = 0;
  let passed = 0;
  const skips = [];
  const lines = [];

  lines.push(`🔎 doc:drift ${RULES.length} rules\n`);

  for (const rule of RULES) {
    let actual;
    try {
      actual = rule.fetch();
    } catch (e) {
      skips.push({ id: rule.id, error: e.message });
      lines.push(`⏭️  ${rule.id}  skipped: ${e.message}`);
      continue;
    }
    let ruleFailed = 0;
    for (const doc of rule.docs) {
      const result = doc.check(actual);
      if (result.ok) {
        passed++;
        lines.push(`✅ ${rule.id}  ${actual}  ok  (${doc.file}:${result.line})`);
      } else {
        failed++;
        ruleFailed++;
        lines.push(`❌ [${rule.id}] ${doc.file}  实际 ${actual}, 文档未匹配`);
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
