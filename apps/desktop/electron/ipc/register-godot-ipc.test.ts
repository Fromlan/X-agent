/** Lock the shared ProjectSettings boundary through the actual tool and IPC handlers. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerGodotIpc } from "./register-godot-ipc";
import { createGodotTools } from "../agent/godot-tools";
import { configureIpcSenderGuard, resetIpcSenderGuard } from "./register-ipc";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { probeGodotEngine } from "../agent/godot-engine-discovery";
import { rememberGodotEditor } from "../agent/prefs";

const prefs = vi.hoisted(() => ({ tools: ["godot_set_project_setting", "godot_get_project_setting"] }));
vi.mock("electron", () => ({ dialog: {} }));
vi.mock("../agent/prefs", () => ({ getCachedPrefs: () => prefs, patchPrefs: vi.fn(), rememberGodotEditor: vi.fn(async () => {}) }));
vi.mock("../agent/godot-engine-discovery", () => ({ probeGodotEngine: vi.fn(async () => ({ path: "C:/Godot.exe", version: "4.6.2.stable" })) }));

/** Register real handlers with a trusted sender, avoiding a live Electron profile. */
function fixture() {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const request = vi.fn(async () => ({ id: "reply", ok: true, result: { saved: true } }));
  const bridge = { request };
  let cwd = "D:/game";
  const connection = {
    getStatus: () => ({ connection: { candidates: [{ path: "C:/Godot.exe", version: "4.6.2.stable" }] } }),
    engineSelected: vi.fn(),
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
    ipc: (call: unknown, inputEvent = event) => handlers.get(IPC_CHANNELS.godotRpcRequest)!(inputEvent, call),
    tool: (payload: unknown) => tool.execute("setting", payload as never, undefined as never, undefined as never, undefined as never),
  };
}

beforeEach(() => { vi.clearAllMocks(); prefs.tools = ["godot_set_project_setting", "godot_get_project_setting"]; });
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
  expect(rememberGodotEditor).toHaveBeenCalledWith("D:/game", "C:/Godot.exe", { setDefault: true });
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
