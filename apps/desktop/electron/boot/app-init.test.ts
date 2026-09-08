/**
 * bootApp wiring (主题 E #62) — 验证 deps 注入与启动期 logo 应用:
 * 1) 首次调用 → 动态 import app-runtime, 跑 bootRuntime (mock)
 * 2) 重复调用 → runtime 已存在, 不重新 import
 * 3) 启动期 logo: 走 notifyLogoChange (C-405 seam), 失败仅 dbgWarn 不抛
 * 4) mainWindow 已存在 / 未销毁 → createMainWindow 不被调, 返回 null
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const bootRuntimeMock = vi.fn();
const shutdownRuntimeMock = vi.fn();
const notifyLogoChangeMock = vi.fn();
const createMainWindowMock = vi.fn(() => null);
const openExternalHttpUrlMock = vi.fn(async () => ({ ok: true }));
const getCachedPrefsMock = vi.fn(() => ({ clientLogoId: "preset:01-neon-cyber" }));
const revealMainMock = vi.fn();
const dbgWarnMock = vi.fn();

let mockMainWindow: { isDestroyed: () => boolean } | null = null;
const getMainWindowMock = vi.fn(() => mockMainWindow);

vi.mock("../../shared/debug-log", () => ({
  dbgWarn: (...args: unknown[]) => dbgWarnMock(...args),
  dbgLog: () => {},
}));

vi.mock("../app-runtime", () => ({
  bootRuntime: (...args: unknown[]) => bootRuntimeMock(...args),
  shutdownRuntime: () => shutdownRuntimeMock(),
  notifyLogoChange: (...args: unknown[]) => notifyLogoChangeMock(...args),
}));

import { bootApp, getRuntime, _resetRuntimeForTests } from "./app-init";

beforeEach(() => {
  vi.clearAllMocks();
  _resetRuntimeForTests();
  // 默认场景: 还没有 mainWindow (splash 启动后第一次 boot)
  mockMainWindow = null;
});

describe("boot/app-init / bootApp", () => {
  it("首次调用: 走 bootRuntime, createMainWindow, 启动期 logo notifyLogoChange", async () => {
    const win = { id: "win-1", isDestroyed: () => false };
    // createMainWindow 模拟 main.ts 把 BrowserWindow 写回 module-scope ref
    createMainWindowMock.mockImplementation(() => {
      mockMainWindow = win;
      return win;
    });

    const created = await bootApp({
      getMainWindow: getMainWindowMock,
      revealMain: revealMainMock,
      openExternalHttpUrl: openExternalHttpUrlMock,
      getCachedPrefs: getCachedPrefsMock,
      createMainWindow: createMainWindowMock,
    });

    expect(bootRuntimeMock).toHaveBeenCalledTimes(1);
    const deps = bootRuntimeMock.mock.calls[0]![0] as {
      getMainWindow: () => unknown;
      revealMainWindow: () => void;
      openExternalHttpUrl: unknown;
    };
    expect(deps.revealMainWindow).toBe(revealMainMock);
    expect(deps.openExternalHttpUrl).toBe(openExternalHttpUrlMock);
    expect(typeof deps.getMainWindow).toBe("function");
    expect(createMainWindowMock).toHaveBeenCalledTimes(1);
    expect(notifyLogoChangeMock).toHaveBeenCalledWith(
      "preset:01-neon-cyber",
      win,
    );
    expect(created).toBe(win);
  });

  it("第二次调用: 已有 mainWindow 时直接返回 null, 不重建", async () => {
    const first = { id: "win-first", isDestroyed: () => false };
    createMainWindowMock.mockReturnValueOnce(first);
    await bootApp({
      getMainWindow: getMainWindowMock,
      revealMain: revealMainMock,
      openExternalHttpUrl: openExternalHttpUrlMock,
      getCachedPrefs: getCachedPrefsMock,
      createMainWindow: createMainWindowMock,
    });
    // 模拟 mainWindow 已存在
    mockMainWindow = first;
    // 第二次 bootApp 应当立刻返回 null
    const created2 = await bootApp({
      getMainWindow: getMainWindowMock,
      revealMain: revealMainMock,
      openExternalHttpUrl: openExternalHttpUrlMock,
      getCachedPrefs: getCachedPrefsMock,
      createMainWindow: createMainWindowMock,
    });
    expect(createMainWindowMock).toHaveBeenCalledTimes(1); // 只调一次
    expect(created2).toBeNull();
  });

  it("mainWindow 已销毁: 当作新窗口重建", async () => {
    const stale = { id: "win-stale", isDestroyed: () => true };
    mockMainWindow = stale;
    const fresh = { id: "win-fresh", isDestroyed: () => false };
    createMainWindowMock.mockImplementation(() => {
      mockMainWindow = fresh;
      return fresh;
    });

    const created = await bootApp({
      getMainWindow: getMainWindowMock,
      revealMain: revealMainMock,
      openExternalHttpUrl: openExternalHttpUrlMock,
      getCachedPrefs: getCachedPrefsMock,
      createMainWindow: createMainWindowMock,
    });

    expect(createMainWindowMock).toHaveBeenCalledTimes(1);
    expect(created).toBe(fresh);
    expect(notifyLogoChangeMock).toHaveBeenCalledWith(
      "preset:01-neon-cyber",
      fresh,
    );
  });

  it("重复 bootApp (都从无 mainWindow 开始): bootRuntime 只跑一次", async () => {
    const win1 = { id: "win-A", isDestroyed: () => false };
    const win2 = { id: "win-B", isDestroyed: () => false };
    createMainWindowMock.mockReturnValueOnce(win1).mockReturnValueOnce(win2);

    // 第一次 bootApp → 创建 win-A
    await bootApp({
      getMainWindow: getMainWindowMock,
      revealMain: revealMainMock,
      openExternalHttpUrl: openExternalHttpUrlMock,
      getCachedPrefs: getCachedPrefsMock,
      createMainWindow: createMainWindowMock,
    });
    // 模拟 win-A 关闭, win-B 是新创建; 第二次 bootApp 会重建
    mockMainWindow = { id: "win-A-closed", isDestroyed: () => true };
    await bootApp({
      getMainWindow: getMainWindowMock,
      revealMain: revealMainMock,
      openExternalHttpUrl: openExternalHttpUrlMock,
      getCachedPrefs: getCachedPrefsMock,
      createMainWindow: createMainWindowMock,
    });

    expect(bootRuntimeMock).toHaveBeenCalledTimes(1);
    expect(createMainWindowMock).toHaveBeenCalledTimes(2);
  });

  it("getCachedPrefs 抛错: dbgWarn, 不阻断主窗口创建", async () => {
    const win = { id: "win-x", isDestroyed: () => false };
    createMainWindowMock.mockReturnValue(win);
    getCachedPrefsMock.mockImplementationOnce(() => {
      throw new Error("prefs cache 损坏");
    });

    const created = await bootApp({
      getMainWindow: getMainWindowMock,
      revealMain: revealMainMock,
      openExternalHttpUrl: openExternalHttpUrlMock,
      getCachedPrefs: getCachedPrefsMock,
      createMainWindow: createMainWindowMock,
    });

    expect(dbgWarnMock).toHaveBeenCalledWith(
      "boot",
      "apply startup logo failed",
      expect.stringContaining("prefs cache 损坏"),
    );
    expect(notifyLogoChangeMock).not.toHaveBeenCalled();
    expect(created).toBe(win);
  });
});

describe("boot/app-init / runtime accessors", () => {
  it("未 boot 时 getRuntime 返回 null", () => {
    expect(getRuntime()).toBeNull();
  });

  it("boot 之后 getRuntime 返回 app-runtime 模块", async () => {
    const win = { id: "win-rt", isDestroyed: () => false };
    createMainWindowMock.mockReturnValue(win);
    await bootApp({
      getMainWindow: getMainWindowMock,
      revealMain: revealMainMock,
      openExternalHttpUrl: openExternalHttpUrlMock,
      getCachedPrefs: getCachedPrefsMock,
      createMainWindow: createMainWindowMock,
    });
    const rt = getRuntime();
    expect(rt).not.toBeNull();
    expect(typeof rt!.bootRuntime).toBe("function");
    expect(typeof rt!.notifyLogoChange).toBe("function");
  });
});
