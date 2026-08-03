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
    authenticatedClients: 1,
    clientInfos: [],
    activeClientId: null,
    startedAt: Date.now() - 10_000,
  },
  addonInstalled: false,
});
assert.ok(godotItems.some((i) => i.id === "rpcAddon" && !i.done));
assert.ok(godotItems.some((i) => i.id === "rpcBridge" && i.done));
assert.ok(godotItems.some((i) => i.id === "godotTools" && !i.done));
assert.ok(!godotItems.some((i) => (i.id as string) === "docs"), "no docs item");
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
    authenticatedClients: 0,
    clientInfos: [],
    activeClientId: null,
    // 越过 8s 宽限期 → 走"启动编辑器"分支
    startedAt: Date.now() - 10_000,
  },
  addonInstalled: true,
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
});
assert.equal(
  offline.find((i) => i.id === "rpcBridge")?.actionKind,
  "startBridge",
);

// 宽限期内：标记为可选，不出现 actionable
const inGrace = buildReadyItems({
  piCli: { ok: true, message: "ok", canInstall: false, piPath: "pi" },
  auth: authOk,
  modelCount: 1,
  bash: bashOk,
  git: gitOk,
  isGodotProject: true,
  prefs: prefsOff,
  rpc: {
    running: true,
    port: 8765,
    clients: 0,
    authenticatedClients: 0,
    clientInfos: [],
    activeClientId: null,
    startedAt: Date.now() - 3_000, // 3s, 仍在 8s 宽限内
  },
  addonInstalled: true,
});
const graceBridge = inGrace.find((i) => i.id === "rpcBridge");
assert.ok(graceBridge && !graceBridge.done, "grace item exists");
assert.equal(graceBridge?.label, "RPC 桥接启动中");
assert.equal(graceBridge?.optional, true, "grace 期为可选,不阻塞清单");
assert.equal(graceBridge?.actionKind, undefined, "grace 期无按钮");

// 握手失败：引导更新插件
const handshakeFailed = buildReadyItems({
  piCli: { ok: true, message: "ok", canInstall: false, piPath: "pi" },
  auth: authOk,
  modelCount: 1,
  bash: bashOk,
  git: gitOk,
  isGodotProject: true,
  prefs: prefsOff,
  rpc: {
    running: true,
    port: 8765,
    clients: 2,
    authenticatedClients: 0,
    clientInfos: [],
    activeClientId: null,
    startedAt: Date.now() - 10_000,
    handshakeFailures: 2,
    lastHandshakeFailure: "bad_token",
    lastAddonVersion: "0.2.0",
    warning: "Godot RPC 握手失败:token 不匹配(插件 v0.2.0)。请重新安装 RPC 插件并重启 Godot。",
  },
  addonInstalled: true,
});
const failBridge = handshakeFailed.find((i) => i.id === "rpcBridge");
assert.ok(failBridge && !failBridge.done, "failed item exists");
assert.equal(failBridge?.actionKind, "installAddon");
assert.match(failBridge?.detail ?? "", /v0\.2\.0/, "detail 透出插件版本");
assert.match(failBridge?.detail ?? "", /token/, "detail 透出 warning");
assert.match(failBridge?.detail ?? "", /2 次/, "detail 透出失败次数");

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
});
assert.ok(!gitOnly.some((i) => i.id === "bash"), "no bash item when bash ok");
const gitItem = gitOnly.find((i) => i.id === "git");
assert.ok(gitItem && !gitItem.done, "git item present");
assert.equal(gitItem?.actionKind, "openGitDownload");

console.log("ready-checklist: ok");
