/**
 * bootApp wiring (主题 E #62) — 验证 deps 注入:
 * 1) 首次调用 → 动态 import app-runtime, 跑 bootRuntime (mock)
 * 2) 重复调用 → runtime 已存在, 不重新 import
 * 3) mainWindow 已存在 / 未销毁 → createMainWindow 不被调, 返回 null
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const bootRuntimeMock = vi.fn();
const shutdownRuntimeMock = vi.fn();
const createMainWindowMock = vi.fn(() => null);
const openExternalHttpUrlMock = vi.fn(async () => ({ ok: true }));
const revealMainMock = vi.fn();

let mockMainWindow: { isDestroyed: () => boolean } | null = null;
const getMainWindowMock = vi.fn(() => mockMainWindow);

vi.mock("../app-runtime", () => ({
  bootRuntime: (...args: unknown[]) => bootRuntimeMock(...args),
  shutdownRuntime: () => shutdownRuntimeMock(),
}));

import { bootApp, getRuntime, _resetRuntimeForTests } from "./app-init";

beforeEach(() => {
  vi.clearAllMocks();
  _resetRuntimeForTests();
  // 默认场景: 还没有 mainWindow (splash 启动后第一次 boot)
  mockMainWindow = null;
});

describe("boot/app-init / bootApp", () => {
  it("首次调用: 走 bootRuntime, createMainWindow", async () => {
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
    expect(created).toBe(win);
  });

  it("第二次调用: 已有 mainWindow 时直接返回 null, 不重建", async () => {
    const first = { id: "win-first", isDestroyed: () => false };
    createMainWindowMock.mockReturnValueOnce(first);
    await bootApp({
      getMainWindow: getMainWindowMock,
      revealMain: revealMainMock,
      openExternalHttpUrl: openExternalHttpUrlMock,
      createMainWindow: createMainWindowMock,
    });
    // 模拟 mainWindow 已存在
    mockMainWindow = first;
    // 第二次 bootApp 应当立刻返回 null
    const created2 = await bootApp({
      getMainWindow: getMainWindowMock,
      revealMain: revealMainMock,
      openExternalHttpUrl: openExternalHttpUrlMock,
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
      createMainWindow: createMainWindowMock,
    });

    expect(createMainWindowMock).toHaveBeenCalledTimes(1);
    expect(created).toBe(fresh);
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
      createMainWindow: createMainWindowMock,
    });
    // 模拟 win-A 关闭, win-B 是新创建; 第二次 bootApp 会重建
    mockMainWindow = { id: "win-A-closed", isDestroyed: () => true };
    await bootApp({
      getMainWindow: getMainWindowMock,
      revealMain: revealMainMock,
      openExternalHttpUrl: openExternalHttpUrlMock,
      createMainWindow: createMainWindowMock,
    });

    expect(bootRuntimeMock).toHaveBeenCalledTimes(1);
    expect(createMainWindowMock).toHaveBeenCalledTimes(2);
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
      createMainWindow: createMainWindowMock,
    });
    const rt = getRuntime();
    expect(rt).not.toBeNull();
    expect(typeof rt!.bootRuntime).toBe("function");
  });
});
