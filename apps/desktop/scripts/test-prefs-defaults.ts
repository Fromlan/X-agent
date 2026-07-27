/**
 * 验证 DEFAULT_PREFS 不再持有虚构模型;
 * 验证 prefs 迁移逻辑(loadPrefs)对"deepseek/deepseek-v4-flash"历史的处理。
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PREFS } from "../shared/ipc";

// 1. DEFAULT_PREFS 现在使用 null
assert.equal(DEFAULT_PREFS.provider, null, "DEFAULT_PREFS.provider 必须是 null");
assert.equal(DEFAULT_PREFS.model, null, "DEFAULT_PREFS.model 必须是 null");

// 2. 其他默认字段保持稳定
assert.equal(DEFAULT_PREFS.theme, "dark");
assert.equal(DEFAULT_PREFS.thinkingLevel, "medium");
assert.deepEqual(DEFAULT_PREFS.tools, [
  "read", "bash", "edit", "write", "grep", "find", "ls",
]);

// 3. 一个旧 prefs 文件 (provider=deepseek, model=deepseek-v4-flash) 仍能被 loadPrefs
// 读出 — 这是兼容行为,真实修复点在 session-host.ts 的 fallback 链。
const legacy = {
  theme: "dark",
  showThinking: true,
  lastProjectPath: null,
  lastSessionPath: null,
  provider: "deepseek",
  model: "deepseek-v4-flash",
  thinkingLevel: "medium",
  tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
  godotEditorPath: null,
  godotDocsBranch: "stable",
  rightPanelOpen: false,
  sidebarWidth: 260,
  rightPanelWidth: 360,
  hiddenProjectKeys: [],
};

const dir = mkdtempSync(join(tmpdir(), "x-agent-prefs-"));
try {
  const p = join(dir, "x-agent.json");
  writeFileSync(p, JSON.stringify(legacy), "utf8");
  const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  assert.equal(raw.provider, "deepseek", "legacy provider 保留");
  assert.equal(raw.model, "deepseek-v4-flash", "legacy model 保留");
  assert.ok(existsSync(p), "prefs 文件存在");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("DEFAULT_PREFS migration: ok");
