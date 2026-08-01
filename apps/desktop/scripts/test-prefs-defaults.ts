/**
 * 验证 DEFAULT_PREFS 不再持有虚构模型;
 * 验证 prefs 主题迁移（legacy `theme` / `cindy` → themeId + colorMode）。
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_PREFS,
  normalizeThemePrefs,
} from "../shared/ipc";

// 1. DEFAULT_PREFS 现在使用 null
assert.equal(DEFAULT_PREFS.provider, null, "DEFAULT_PREFS.provider 必须是 null");
assert.equal(DEFAULT_PREFS.model, null, "DEFAULT_PREFS.model 必须是 null");

// 2. 其他默认字段保持稳定
assert.equal(DEFAULT_PREFS.themeId, "default");
assert.equal(DEFAULT_PREFS.colorMode, "dark");
assert.equal(DEFAULT_PREFS.thinkingLevel, "high");
assert.deepEqual(DEFAULT_PREFS.dismissedReadyChecklistKeys, []);
assert.deepEqual(DEFAULT_PREFS.dismissedGodotToolsNudgeKeys, []);
assert.equal(DEFAULT_PREFS.autoCompactPercent, 0);
assert.equal(DEFAULT_PREFS.goalMaxTurns, 20);
assert.equal(DEFAULT_PREFS.goalMaxTokens, 500_000);
assert.ok(!("updateSource" in DEFAULT_PREFS));
assert.deepEqual(DEFAULT_PREFS.tools, [
  "read", "bash", "edit", "write", "grep", "find", "ls",
]);

// 3. legacy theme → colorMode 迁移
assert.deepEqual(normalizeThemePrefs({ theme: "light" }), {
  themeId: "default",
  colorMode: "light",
});
assert.deepEqual(normalizeThemePrefs({ theme: "dark" }), {
  themeId: "default",
  colorMode: "dark",
});
assert.deepEqual(
  normalizeThemePrefs({ themeId: "nord", colorMode: "light", theme: "dark" }),
  { themeId: "nord", colorMode: "light" },
);
assert.deepEqual(normalizeThemePrefs({ themeId: "cindy", colorMode: "dark" }), {
  themeId: "default",
  colorMode: "dark",
});

// 4. 一个旧 prefs 文件 (provider=deepseek, model=deepseek-v4-flash) 仍能被读出
const legacy = {
  theme: "dark",
  showThinking: true,
  lastProjectPath: null,
  lastSessionPath: null,
  provider: "deepseek",
  model: "deepseek-v4-flash",
  thinkingLevel: "high",
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
  const migrated = normalizeThemePrefs(raw);
  assert.equal(migrated.themeId, "default");
  assert.equal(migrated.colorMode, "dark");
  assert.ok(existsSync(p), "prefs 文件存在");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("DEFAULT_PREFS migration: ok");
