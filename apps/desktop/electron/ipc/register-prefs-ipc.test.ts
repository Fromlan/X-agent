/**
 * register-prefs-ipc (主题 E #62 主题 E-3) — 显式 deps 注入, schema 校验,
 * 工具白名单, logo 变更走 notifyLogoChange. 不依赖 ~/.pi/agent 真实读写.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { registerPrefsIpc } from "./register-prefs-ipc";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { DEFAULT_PREFS } from "../../shared/ipc";
import { handle } from "./register-ipc";

const calls: Array<[string, (...args: unknown[]) => unknown]> = [];
const ipcMain = {
  handle: vi.fn((c: string, f: never) => calls.push([c, f])),
};

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
});

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const entry = calls.find(([c]) => c === channel);
  if (!entry) throw new Error(`no handler for ${channel}`);
  return entry[1];
}

function makeDeps(overrides?: {
  loadPrefs?: () => typeof DEFAULT_PREFS;
  patchPrefs?: (patch: unknown) => Promise<typeof DEFAULT_PREFS>;
  getCachedPrefs?: () => typeof DEFAULT_PREFS;
  applyTools?: (tools: string[]) => Promise<unknown>;
  reloadResources?: () => Promise<unknown>;
  notifyLogoChange?: (id: string, win: unknown) => void;
}) {
  return {
    loadPrefs: overrides?.loadPrefs ?? (() => ({ ...DEFAULT_PREFS, clientLogoId: "default" })),
    patchPrefs: overrides?.patchPrefs ?? (async () => ({ ...DEFAULT_PREFS, clientLogoId: "default" })),
    getCachedPrefs: overrides?.getCachedPrefs ?? (() => ({ ...DEFAULT_PREFS, clientLogoId: "default" })),
    applyTools: overrides?.applyTools ?? (async () => undefined),
    reloadResources: overrides?.reloadResources ?? (async () => undefined),
    notifyLogoChange: overrides?.notifyLogoChange ?? (() => {}),
    getMainWindow: () => null,
  };
}

describe("register-prefs-ipc / getPrefs", () => {
  it("通过 deps.loadPrefs 同步读 prefs", async () => {
    const deps = makeDeps({
      loadPrefs: () => ({ ...DEFAULT_PREFS, clientLogoId: "preset:01-neon-cyber" }),
    });
    registerPrefsIpc(ipcMain as never, deps);
    const handler = getHandler(IPC_CHANNELS.getPrefs);
    const result = (await handler({})) as { clientLogoId: string };
    expect(result.clientLogoId).toBe("preset:01-neon-cyber");
  });
});

describe("register-prefs-ipc / setPrefs schema 校验 (S4)", () => {
  it("拒绝非对象 patch (string / number / null)", async () => {
    const deps = makeDeps();
    registerPrefsIpc(ipcMain as never, deps);
    const handler = getHandler(IPC_CHANNELS.setPrefs);
    // handler 签名 (event, patch), 所以传两个位置参
    await expect(handler({}, null)).rejects.toThrow(/必须是对象/);
    await expect(handler({}, "string")).rejects.toThrow(/必须是对象/);
    await expect(handler({}, 123)).rejects.toThrow(/必须是对象/);
    await expect(handler({}, [])).rejects.toThrow(/必须是对象/);
  });

  it("拒绝未声明字段 (legacy language / theme)", async () => {
    const deps = makeDeps();
    registerPrefsIpc(ipcMain as never, deps);
    const handler = getHandler(IPC_CHANNELS.setPrefs);
    await expect(handler({}, { language: "zh" })).rejects.toThrow(
      /prefs patch 校验失败/,
    );
    await expect(handler({}, { theme: "dark" })).rejects.toThrow(
      /prefs patch 校验失败/,
    );
  });

  it("接受合法字段, 走 patchPrefs 写回", async () => {
    const patchSpy = vi.fn(async () => ({
      ...DEFAULT_PREFS,
      clientLogoId: "default",
      goalMaxTurns: 100,
    }));
    const deps = makeDeps({ patchPrefs: patchSpy });
    registerPrefsIpc(ipcMain as never, deps);
    const handler = getHandler(IPC_CHANNELS.setPrefs);
    const result = (await handler({}, { goalMaxTurns: 100 })) as {
      goalMaxTurns: number;
    };
    expect(patchSpy).toHaveBeenCalledWith({ goalMaxTurns: 100 });
    expect(result.goalMaxTurns).toBe(100);
  });
});

describe("register-prefs-ipc / setPrefs 工具白名单", () => {
  it("tools 字段被白名单过滤后再 applyTools", async () => {
    const applyTools = vi.fn(async () => undefined);
    const patchSpy = vi.fn(async () => ({
      ...DEFAULT_PREFS,
      clientLogoId: "default",
    }));
    const deps = makeDeps({ applyTools, patchPrefs: patchSpy });
    registerPrefsIpc(ipcMain as never, deps);
    const handler = getHandler(IPC_CHANNELS.setPrefs);
    await handler(
      {},
      {
        tools: ["read", "evil-tool", "bash", "../escape"],
        goalMaxTurns: 50,
      },
    );
    // 白名单仅保留 read / bash, evil-tool 和 ../escape 被过滤
    expect(applyTools).toHaveBeenCalledWith(["read", "bash"]);
    expect(patchSpy).toHaveBeenCalledWith({ goalMaxTurns: 50 });
  });
});

describe("register-prefs-ipc / setPrefs disabledSkills 触发 reloadResources", () => {
  it("patch 含 disabledSkills 时 reloadResources 被调", async () => {
    const reload = vi.fn(async () => undefined);
    const deps = makeDeps({ reloadResources: reload });
    registerPrefsIpc(ipcMain as never, deps);
    const handler = getHandler(IPC_CHANNELS.setPrefs);
    await handler({}, { disabledSkills: ["godot"] });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("patch 不含 disabledSkills 时 reloadResources 不被调", async () => {
    const reload = vi.fn(async () => undefined);
    const deps = makeDeps({ reloadResources: reload });
    registerPrefsIpc(ipcMain as never, deps);
    const handler = getHandler(IPC_CHANNELS.setPrefs);
    await handler({}, { goalMaxTurns: 50 });
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("register-prefs-ipc / setPrefs logo 变更走 notifyLogoChange (C-405 seam)", () => {
  it("clientLogoId 从 default 切到 preset 时通知 renderer", async () => {
    const notify = vi.fn();
    const deps = makeDeps({
      getCachedPrefs: () => ({ ...DEFAULT_PREFS, clientLogoId: "default" }),
      patchPrefs: async () => ({
        ...DEFAULT_PREFS,
        clientLogoId: "preset:01-neon-cyber",
      }),
      notifyLogoChange: notify,
    });
    registerPrefsIpc(ipcMain as never, deps);
    const handler = getHandler(IPC_CHANNELS.setPrefs);
    await handler({}, { clientLogoId: "preset:01-neon-cyber" });
    expect(notify).toHaveBeenCalledWith(
      "preset:01-neon-cyber",
      null,
    );
  });

  it("clientLogoId 不变时不重复通知", async () => {
    const notify = vi.fn();
    const deps = makeDeps({
      getCachedPrefs: () => ({ ...DEFAULT_PREFS, clientLogoId: "default" }),
      patchPrefs: async () => ({ ...DEFAULT_PREFS, clientLogoId: "default" }),
      notifyLogoChange: notify,
    });
    registerPrefsIpc(ipcMain as never, deps);
    const handler = getHandler(IPC_CHANNELS.setPrefs);
    await handler({}, { clientLogoId: "default" });
    expect(notify).not.toHaveBeenCalled();
  });
});
