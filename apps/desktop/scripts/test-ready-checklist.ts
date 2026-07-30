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

const itemsGlobal = buildReadyItems({
  piCli: null,
  auth: authBad,
  modelCount: 0,
  bash: bashBad,
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
assert.ok(
  itemsGlobal.some((i) => i.id === "bash" && !i.done),
  "bash item present",
);
assert.ok(!itemsGlobal.some((i) => i.id === "rpcAddon"), "no godot items");

const prefsOff: ClientPrefs = { ...DEFAULT_PREFS, tools: [...DEFAULT_PREFS.tools] };
const godotItems = buildReadyItems({
  piCli: { ok: true, message: "ok", canInstall: false, piPath: "pi" },
  auth: authOk,
  modelCount: 2,
  bash: { ok: true, message: "ok", shellPath: "bash", suggestedShellPath: null },
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
  bash: { ok: true, message: "ok", shellPath: "bash", suggestedShellPath: null },
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
  bash: { ok: true, message: "ok", shellPath: "bash", suggestedShellPath: null },
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

console.log("ready-checklist: ok");
