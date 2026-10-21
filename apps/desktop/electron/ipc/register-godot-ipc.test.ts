/** Lock the shared ProjectSettings boundary through the actual tool and IPC handlers. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerGodotIpc } from "./register-godot-ipc";
import { createGodotTools } from "../agent/godot-tools";
import { configureIpcSenderGuard, resetIpcSenderGuard } from "./register-ipc";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { probeGodotEngine } from "../agent/godot-engine-discovery";
import { rememberGodotEditor } from "../agent/prefs";
import { registerGodotEngine, updateGodotEngine } from "../agent/prefs";
import { dialog } from "electron";
import { DEFAULT_PREFS } from "../../shared/ipc";

const prefs = vi.hoisted(() => ({
  tools: ["godot_set_project_setting", "godot_get_project_setting"],
  godotEngines: [{ path: "C:/saved.exe", name: "Saved", version: "4.7.2.stable" }],
  godotEditorPath: null as string | null,
  godotProjectEditors: {} as Record<string, string>,
}));
vi.mock("electron", () => ({ dialog: { showOpenDialog: vi.fn() } }));
vi.mock("../agent/prefs", () => ({ getCachedPrefs: () => prefs, patchPrefs: vi.fn(), rememberGodotEditor: vi.fn(async () => {}), registerGodotEngine: vi.fn(), updateGodotEngine: vi.fn() }));
vi.mock("../agent/godot-engine-discovery", () => ({ probeGodotEngine: vi.fn(async () => ({ path: "C:/Godot.exe", version: "4.6.2.stable" })) }));

/** Register real handlers with a trusted sender, avoiding a live Electron profile. */
function fixture(connectionState: { projectPath?: string; enginePath?: string } = {}) {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const request = vi.fn(async () => ({ id: "reply", ok: true, result: { saved: true } }));
  const bridge = { request };
  let cwd = "D:/game";
  const connection = {
    getStatus: () => ({ connection: { ...connectionState, candidates: [{ path: "C:/Godot.exe", version: "4.6.2.stable" }] } }),
    engineSelected: vi.fn(),
    engineSettingsChanged: vi.fn(),
  };
  const sender = {};
  const event = { sender, senderFrame: { url: "file:///app/index.html" } };
  configureIpcSenderGuard(() => ({ webContents: sender, isDestroyed: () => false }) as never, null);
  registerGodotIpc({ handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) } as never, { getStatus: () => ({ cwd }) } as never, bridge as never, connection as never);
  const tool = createGodotTools(bridge as never).find((entry) => entry.name === "godot_set_project_setting")!;
  return {
    request,
    connection,
    switchProject: () => { cwd = "D:/other"; },
    pickEngine: (path: unknown) => handlers.get(IPC_CHANNELS.pickGodotEditor)!(event, path),
    manageEngine: (input: unknown, inputEvent = event) => handlers.get(IPC_CHANNELS.manageGodotEngine)!(inputEvent, input),
    ipc: (call: unknown, inputEvent = event) => handlers.get(IPC_CHANNELS.godotRpcRequest)!(inputEvent, call),
    tool: (payload: unknown) => tool.execute("setting", payload as never, undefined as never, undefined as never, undefined as never),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prefs.tools = ["godot_set_project_setting", "godot_get_project_setting"];
  prefs.godotEditorPath = null;
  prefs.godotProjectEditors = {};
});
afterEach(() => resetIpcSenderGuard());

describe.each(["ipc", "tool"] as const)("%s ProjectSettings ingress", (ingress) => {
  it.each([
    ["autoload/Attack", "res://attack.gd"],
    ["input/ui_accept", {}],
    ["debug/file_logging/enable_file_logging", true],
    ["application/config/project_settings_override", "res://evil.cfg"],
    ["application/config/project_settings_override.windows", "res://evil.cfg"],
    ["application/config/project_settings_override.windows.debug", "res://evil.cfg"],
    ["application/config/disable_project_settings_override", false],
    ["application/config/disable_project_settings_override.windows", false],
    ["application/config/name", null],
    ["application/config/name", { a: { b: { c: "deep" } } }],
    ["display/window/size/viewport_width", Number.NaN],
  ])("blocks unsafe payload %s without forwarding", async (key, value) => {
    const context = fixture();
    const payload = { method: "set_project_setting", key, value };
    const result = await context[ingress](payload);
    expect(ingress === "ipc" ? result : (result as { details: unknown }).details).toMatchObject({ ok: false });
    expect(context.request).not.toHaveBeenCalled();
  });
  it("preserves legal settings and normalizes the forwarded key", async () => {
    const context = fixture();
    const result = await context[ingress]({ method: "set_project_setting", key: " display/window/size/viewport_width ", value: 1280 });
    expect(ingress === "ipc" ? result : (result as { details: unknown }).details).toMatchObject({ ok: true });
    expect(context.request).toHaveBeenCalledWith(expect.objectContaining({ method: "set_project_setting", key: "display/window/size/viewport_width", value: 1280 }), expect.any(Number));
  });
});

it("retains the Godot tool enablement gate", async () => {
  const context = fixture();
  prefs.tools = [];
  expect(await context.ipc({ method: "set_project_setting", key: "application/config/name", value: "Game" })).toMatchObject({ ok: false, error: expect.stringContaining("未启用") });
  expect(context.request).not.toHaveBeenCalled();
});

it("retains sender validation before the shared setting boundary", async () => {
  const context = fixture();
  await expect(context.ipc({ method: "set_project_setting", key: "application/config/name", value: "Game" }, { sender: {}, senderFrame: { url: "file:///app/index.html" } })).rejects.toMatchObject({ __senderUntrusted: true });
  expect(context.request).not.toHaveBeenCalled();
});

it("rejects engine paths outside the current discovered list before executing or persisting them", async () => {
  const context = fixture();
  expect(await context.pickEngine("C:/arbitrary.exe")).toMatchObject({ ok: false });
  expect(probeGodotEngine).not.toHaveBeenCalled();
  expect(rememberGodotEditor).not.toHaveBeenCalled();
});

it("records a validated discovered engine for the current project and resumes connection", async () => {
  const context = fixture();
  expect(await context.pickEngine("c:\\godot.exe")).toMatchObject({ ok: true, path: "C:/Godot.exe" });
  expect(rememberGodotEditor).toHaveBeenCalledWith("D:/game", "C:/Godot.exe");
  expect(context.connection.engineSelected).toHaveBeenCalledWith("C:/Godot.exe");
});

it("a project switch during engine validation cannot save the selection into another project", async () => {
  const context = fixture();
  vi.mocked(probeGodotEngine).mockImplementationOnce(async () => {
    context.switchProject();
    return { path: "C:/Godot.exe", version: "4.6.2.stable" };
  });
  expect(await context.pickEngine("C:/Godot.exe")).toMatchObject({ ok: false, error: expect.stringContaining("项目已切换") });
  expect(rememberGodotEditor).not.toHaveBeenCalled();
});

it("adds a probed engine through the native picker without changing defaults or launching", async () => {
  const context = fixture();
  vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ["C:/Godot.exe"] });
  vi.mocked(registerGodotEngine).mockResolvedValueOnce(DEFAULT_PREFS);
  expect(await context.manageEngine({ action: "add" })).toMatchObject({ ok: true, prefs: DEFAULT_PREFS });
  expect(registerGodotEngine).toHaveBeenCalledWith(expect.objectContaining({ path: "C:/Godot.exe", version: "4.6.2.stable" }));
  expect(rememberGodotEditor).not.toHaveBeenCalled();
  expect(context.connection.engineSelected).not.toHaveBeenCalled();
});

it("does not execute arbitrary paths or accept malformed registry commands", async () => {
  const context = fixture();
  for (const input of [null, { action: "default", path: "C:/arbitrary.exe" }, { action: "add", path: "C:/arbitrary.exe" }, { action: "rename", path: "C:/saved.exe", name: "" }]) {
    expect(await context.manageEngine(input)).toMatchObject({ ok: false });
  }
  expect(probeGodotEngine).not.toHaveBeenCalled();
  expect(updateGodotEngine).not.toHaveBeenCalled();
});

it("binds a registered engine to the active project without changing the default", async () => {
  const context = fixture();
  vi.mocked(updateGodotEngine).mockResolvedValueOnce(DEFAULT_PREFS);
  expect(await context.manageEngine({ action: "project", path: "C:/saved.exe", projectPath: "D:/game" })).toMatchObject({ ok: true });
  expect(updateGodotEngine).toHaveBeenCalledWith({ action: "project", path: "C:/saved.exe", projectPath: "D:/game" });
  expect(context.connection.engineSelected).toHaveBeenCalledWith("C:/saved.exe");
});

it("rejects a stale project selection before and after executable validation", async () => {
  const context = fixture();
  expect(await context.manageEngine({ action: "project", path: null, projectPath: "D:/old" })).toMatchObject({ ok: false });
  vi.mocked(probeGodotEngine).mockImplementationOnce(async () => {
    context.switchProject();
    return { path: "C:/saved.exe", version: "4.7.2.stable" };
  });
  expect(await context.manageEngine({ action: "project", path: "C:/saved.exe", projectPath: "D:/game" })).toMatchObject({ ok: false });
  expect(updateGodotEngine).not.toHaveBeenCalled();
});

it("returns cancellation and persistence errors without losing current settings", async () => {
  const context = fixture();
  vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] });
  expect(await context.manageEngine({ action: "add" })).toMatchObject({ canceled: true });
  vi.mocked(updateGodotEngine).mockRejectedValueOnce(new Error("disk unavailable"));
  expect(await context.manageEngine({ action: "remove", path: "C:/saved.exe" })).toMatchObject({ ok: false, error: "disk unavailable" });
  await expect(context.manageEngine({ action: "add" }, { sender: {}, senderFrame: { url: "file:///app/index.html" } })).rejects.toMatchObject({ __senderUntrusted: true });
});

it.each(["remove", "default"] as const)("does not cancel a project bound to another engine after %s", async (action) => {
  const context = fixture();
  prefs.godotProjectEditors = { "d:/game": "C:/pinned.exe" };
  vi.mocked(updateGodotEngine).mockResolvedValueOnce({ ...DEFAULT_PREFS, ...prefs });
  expect(await context.manageEngine({ action, path: "C:/saved.exe" })).toMatchObject({ ok: true });
  expect(context.connection.engineSettingsChanged).not.toHaveBeenCalled();
});

it("cancels the current project's connection when its own pinned engine is removed", async () => {
  const context = fixture();
  prefs.godotProjectEditors = { "d:/game": "C:/saved.exe" };
  vi.mocked(updateGodotEngine).mockResolvedValueOnce(DEFAULT_PREFS);
  expect(await context.manageEngine({ action: "remove", path: "C:/saved.exe" })).toMatchObject({ ok: true });
  expect(context.connection.engineSettingsChanged).toHaveBeenCalledOnce();
});

it("invalidates an unpinned project when its global default changes", async () => {
  const context = fixture();
  vi.mocked(updateGodotEngine).mockResolvedValueOnce({ ...DEFAULT_PREFS, godotEditorPath: "C:/saved.exe" });
  expect(await context.manageEngine({ action: "default", path: "C:/saved.exe" })).toMatchObject({ ok: true });
  expect(context.connection.engineSettingsChanged).toHaveBeenCalledOnce();
});

it("preserves an unpinned project's selected engine when another entry is removed", async () => {
  const context = fixture({ projectPath: "D:/game", enginePath: "C:/Godot.exe" });
  vi.mocked(updateGodotEngine).mockResolvedValueOnce(DEFAULT_PREFS);
  expect(await context.manageEngine({ action: "remove", path: "C:/saved.exe" })).toMatchObject({ ok: true });
  expect(context.connection.engineSettingsChanged).not.toHaveBeenCalled();
});
