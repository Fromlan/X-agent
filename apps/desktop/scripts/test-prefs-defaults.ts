/**
 * 验证 DEFAULT_PREFS 不再持有虚构模型;
 * 验证 prefs 主题迁移（legacy `theme` / `cindy` → themeId + colorMode）。
 * 验证 disabledSkills 归一化。
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadPrefs,
  patchPrefs,
  setAgentDirOverrideForTests,
} from "../electron/agent/prefs";
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
assert.deepEqual(DEFAULT_PREFS.disabledSkills, []);
assert.equal(DEFAULT_PREFS.autoCompactPercent, 0);
assert.equal(DEFAULT_PREFS.goalMaxTurns, 20);
assert.equal(DEFAULT_PREFS.goalMaxTokens, 500_000);
assert.equal(DEFAULT_PREFS.clientLogoId, "default", "DEFAULT_PREFS.clientLogoId");
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

// 5. disabledSkills 归一化（空白 / 非字符串 → 干净 string[]）
const skillPrefsDir = mkdtempSync(join(tmpdir(), "x-agent-skill-prefs-"));
try {
  setAgentDirOverrideForTests(skillPrefsDir);
  writeFileSync(
    join(skillPrefsDir, "x-agent.json"),
    JSON.stringify({
      ...DEFAULT_PREFS,
      disabledSkills: ["  x-grill  ", "", 12, "x-tdd"],
    }),
    "utf8",
  );
  const loaded = loadPrefs();
  console.log("DEBUG loaded.disabledSkills:", loaded.disabledSkills);
  assert.deepEqual(
    loaded.disabledSkills,
    ["x-grill", "x-tdd"],
    "disabledSkills trims and drops invalid entries",
  );
  const patched = await patchPrefs({ disabledSkills: ["  Foo ", ""] });
  assert.deepEqual(patched.disabledSkills, ["Foo"], "patchPrefs normalizes");
} finally {
  setAgentDirOverrideForTests(null);
  rmSync(skillPrefsDir, { recursive: true, force: true });
}

// 6. lastProjectPath 只接受已存在目录（下游 addon 安装把它当权威项目路径）
const projectPrefsDir = mkdtempSync(join(tmpdir(), "x-agent-project-prefs-"));
const realDir = join(projectPrefsDir, "real-project");
mkdirSync(realDir, { recursive: true });
try {
  setAgentDirOverrideForTests(projectPrefsDir);
  const base = await patchPrefs({ lastProjectPath: null });
  assert.equal(base.lastProjectPath, null, "base null");

  const valid = await patchPrefs({ lastProjectPath: realDir });
  assert.equal(valid.lastProjectPath, realDir, "existing dir accepted");

  const invalid = await patchPrefs({
    lastProjectPath: "C:\\definitely\\not\\a\\real\\dir",
  });
  assert.equal(
    invalid.lastProjectPath,
    realDir,
    "non-directory path is ignored (keeps previous)",
  );

  const cleared = await patchPrefs({ lastProjectPath: "" });
  assert.equal(cleared.lastProjectPath, null, "empty string clears");
} finally {
  setAgentDirOverrideForTests(null);
  rmSync(projectPrefsDir, { recursive: true, force: true });
}

// 7. clientLogoId 白名单 + 加载时 dirty 兜底为 "default"
const logoPrefsDir = mkdtempSync(join(tmpdir(), "x-agent-logo-prefs-"));
try {
  setAgentDirOverrideForTests(logoPrefsDir);
  const base = await patchPrefs({ clientLogoId: "default" });
  assert.equal(base.clientLogoId, "default");

  const preset = await patchPrefs({ clientLogoId: "preset:03-plasma-thunder" });
  assert.equal(preset.clientLogoId, "preset:03-plasma-thunder");

  const custom = await patchPrefs({
    clientLogoId: "custom:7f3c0a4d-1234-5678-9abc-def012345678",
  });
  assert.equal(custom.clientLogoId, "custom:7f3c0a4d-1234-5678-9abc-def012345678");

  // 拒绝任意路径 / 脚本片段 / 外部 scheme
  const evil = await patchPrefs({ clientLogoId: "../../etc/passwd" });
  assert.equal(evil.clientLogoId, "custom:7f3c0a4d-1234-5678-9abc-def012345678",
    "evil clientLogoId is ignored, keeps previous value");

  // 空字符串 → 默认
  const blanked = await patchPrefs({ clientLogoId: "   " });
  assert.equal(blanked.clientLogoId, "default", "blank clientLogoId reverts to default");

  // 加载时：磁盘上的脏值（不在白名单命名空间）→ default
  writeFileSync(
    join(logoPrefsDir, "x-agent.json"),
    JSON.stringify({ ...DEFAULT_PREFS, clientLogoId: "garbage-not-in-whitelist" }),
    "utf8",
  );
  setAgentDirOverrideForTests(null);
  setAgentDirOverrideForTests(logoPrefsDir);
  const reloaded = loadPrefs();
  assert.equal(reloaded.clientLogoId, "default",
    "on-disk value outside the default/preset:/custom: namespace is normalized to default");
} finally {
  setAgentDirOverrideForTests(null);
  rmSync(logoPrefsDir, { recursive: true, force: true });
}

console.log("DEFAULT_PREFS migration: ok");
