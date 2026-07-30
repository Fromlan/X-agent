/**
 * Ready checklist builders + Godot tool helpers.
 */
import assert from "node:assert/strict";
import {
  DEFAULT_PREFS,
  GODOT_TOOLS,
  type AuthStatus,
  type BashCheckResult,
  type ClientPrefs,
  type GitCheckResult,
} from "../shared/ipc";

// Inline the pure helpers by importing from the renderer lib via relative path.
// The module has no React deps.
import {
  allGodotEditorToolsEnabled,
  buildReadyItems,
  readyChecklistHasBlocking,
} from "../src/lib/ready-checklist";

const authBad: AuthStatus = { ok: false, message: "未登录", authPath: "" };
const authOk: AuthStatus = { ok: true, message: "ok", authPath: "" };
const bashBad: BashCheckResult = {
  ok: false,
  message: "未找到 bash",
  shellPath: null,
  suggestedShellPath: null,
};
const bashOk: BashCheckResult = {
  ok: true,
  message: "ok",
  shellPath: "bash",
  suggestedShellPath: null,
};
const bashWritable: BashCheckResult = {
  ok: true,
  message: "已找到 bash: C:\\Git\\bin\\bash.exe（可写入 Pi settings）",
  shellPath: "C:\\Git\\bin\\bash.exe",
  suggestedShellPath: "C:\\Git\\bin\\bash.exe",
};
const gitOk: GitCheckResult = { ok: true, gitPath: "git", message: "ok" };
const gitBad: GitCheckResult = {
  ok: false,
  gitPath: null,
  message: "未检测到 git",
};

const itemsGlobal = buildReadyItems({
  piCli: null,
  auth: authBad,
  modelCount: 0,
  bash: bashBad,
  git: gitOk,
  isGodotProject: false,
  prefs: DEFAULT_PREFS,
  rpc: null,
  addonInstalled: null,
  docs: null,
});
assert.ok(
  itemsGlobal.some((i) => i.id === "auth" && !i.done),
  "auth item present",
);
const bashItem = itemsGlobal.find((i) => i.id === "bash");
assert.ok(bashItem && !bashItem.done, "bash item present");
assert.equal(bashItem?.actionKind, "openGitDownload", "missing bash → download Git");
assert.ok(!itemsGlobal.some((i) => i.id === "rpcAddon"), "no godot items");

const prefsOff: ClientPrefs = { ...DEFAULT_PREFS, tools: [...DEFAULT_PREFS.tools] };
const godotItems = buildReadyItems({
  piCli: { ok: true, message: "ok", canInstall: false, piPath: "pi" },
  auth: authOk,
  modelCount: 2,
  bash: bashOk,
  git: gitOk,
  isGodotProject: true,
  prefs: prefsOff,
  rpc: {
    running: true,
    port: 8765,
    clients: 1,
    clientInfos: [],
    activeClientId: null,
  },
  addonInstalled: false,
  docs: {
    status: "missing",
    branch: "stable",
    root: "",
    localBranches: [],
    remoteBranches: [],
    downloadUrl: "",
    docsSiteVersion: "",
  },
});
assert.ok(godotItems.some((i) => i.id === "rpcAddon" && !i.done));
assert.ok(godotItems.some((i) => i.id === "rpcBridge" && i.done));
assert.ok(godotItems.some((i) => i.id === "godotTools" && !i.done));
assert.ok(godotItems.some((i) => i.id === "docs" && i.optional && !i.done));
assert.ok(readyChecklistHasBlocking(godotItems));

const waiting = buildReadyItems({
  piCli: { ok: true, message: "ok", canInstall: false, piPath: "pi" },
  auth: authOk,
  modelCount: 2,
  bash: bashOk,
  git: gitOk,
  isGodotProject: true,
  prefs: prefsOff,
  rpc: {
    running: true,
    port: 8765,
    clients: 0,
    clientInfos: [],
    activeClientId: null,
  },
  addonInstalled: true,
  docs: {
    status: "missing",
    branch: "stable",
    root: "",
    localBranches: [],
    remoteBranches: [],
    downloadUrl: "",
    docsSiteVersion: "",
  },
});
const waitingBridge = waiting.find((i) => i.id === "rpcBridge");
assert.ok(waitingBridge && !waitingBridge.done, "waiting for client");
assert.equal(waitingBridge?.actionKind, "launchEditor");
assert.match(waitingBridge?.detail ?? "", /8765/);

const offline = buildReadyItems({
  piCli: { ok: true, message: "ok", canInstall: false, piPath: "pi" },
  auth: authOk,
  modelCount: 2,
  bash: bashOk,
  git: gitOk,
  isGodotProject: true,
  prefs: prefsOff,
  rpc: {
    running: false,
    port: 8765,
    clients: 0,
    clientInfos: [],
    activeClientId: null,
  },
  addonInstalled: true,
  docs: {
    status: "missing",
    branch: "stable",
    root: "",
    localBranches: [],
    remoteBranches: [],
    downloadUrl: "",
    docsSiteVersion: "",
  },
});
assert.equal(
  offline.find((i) => i.id === "rpcBridge")?.actionKind,
  "startBridge",
);

assert.equal(allGodotEditorToolsEnabled(prefsOff), false);
const prefsOn: ClientPrefs = {
  ...DEFAULT_PREFS,
  tools: [...DEFAULT_PREFS.tools, ...GODOT_TOOLS],
};
assert.equal(allGodotEditorToolsEnabled(prefsOn), true);

// Pi missing + no npm → Node download item (not installPi)
const noNpm = buildReadyItems({
  piCli: {
    ok: false,
    piPath: null,
    canInstall: false,
    message: "未检测到全局 Pi CLI，且未找到 npm",
  },
  auth: authOk,
  modelCount: 1,
  bash: bashOk,
  git: gitOk,
  isGodotProject: false,
  prefs: DEFAULT_PREFS,
  rpc: null,
  addonInstalled: null,
  docs: null,
});
const nodeItem = noNpm.find((i) => i.id === "node");
assert.ok(nodeItem && !nodeItem.done, "node item when npm missing");
assert.equal(nodeItem?.actionKind, "openNodeDownload");
assert.ok(!noNpm.some((i) => i.id === "piCli"), "no piCli install when !canInstall");

// Pi missing + npm → install Pi
const withNpm = buildReadyItems({
  piCli: {
    ok: false,
    piPath: null,
    canInstall: true,
    message: "未检测到全局 Pi CLI",
  },
  auth: authOk,
  modelCount: 1,
  bash: bashOk,
  git: gitOk,
  isGodotProject: false,
  prefs: DEFAULT_PREFS,
  rpc: null,
  addonInstalled: null,
  docs: null,
});
const piItem = withNpm.find((i) => i.id === "piCli");
assert.ok(piItem && !piItem.done);
assert.equal(piItem?.actionKind, "installPi");

// bash found but not written → applyBash
const writeBash = buildReadyItems({
  piCli: null,
  auth: authOk,
  modelCount: 1,
  bash: bashWritable,
  git: gitOk,
  isGodotProject: false,
  prefs: DEFAULT_PREFS,
  rpc: null,
  addonInstalled: null,
  docs: null,
});
assert.equal(
  writeBash.find((i) => i.id === "bash")?.actionKind,
  "applyBash",
);

// bash ok + git fail → only git item
const gitOnly = buildReadyItems({
  piCli: null,
  auth: authOk,
  modelCount: 1,
  bash: bashOk,
  git: gitBad,
  isGodotProject: false,
  prefs: DEFAULT_PREFS,
  rpc: null,
  addonInstalled: null,
  docs: null,
});
assert.ok(!gitOnly.some((i) => i.id === "bash"), "no bash item when bash ok");
const gitItem = gitOnly.find((i) => i.id === "git");
assert.ok(gitItem && !gitItem.done, "git item present");
assert.equal(gitItem?.actionKind, "openGitDownload");

console.log("ready-checklist: ok");
