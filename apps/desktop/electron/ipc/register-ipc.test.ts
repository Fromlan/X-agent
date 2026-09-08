import { describe, expect, it, vi } from "vitest";
import {
  isSenderUntrustedError,
  type IpcInvokeResult,
} from "../../shared/ipc";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import {
  configureIpcSenderGuard,
  handle,
  makeSenderUntrustedError,
  resetIpcSenderGuard,
} from "./register-ipc";

describe("ipc channel registry", () => {
  it("key names equal channel values (preload generation depends on this)", () => {
    for (const [key, value] of Object.entries(IPC_CHANNELS)) {
      expect(value).toBe(key);
    }
  });
});

describe("handle registrar", () => {
  it("forwards channel name and handler to ipcMain", async () => {
    const calls: Array<[string, (...args: unknown[]) => unknown]> = [];
    const ipcMain = { handle: vi.fn((c: string, f: never) => calls.push([c, f])) };
    const result = { ok: true, cwd: "", sessionId: "" };

    handle(ipcMain as never, IPC_CHANNELS.newSession, async () => result);

    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe(IPC_CHANNELS.newSession);
    await expect(calls[0]![1]()).resolves.toBe(result);
  });
});

describe("isSenderUntrustedError typeguard (issue #65 主题 H)", () => {
  it("识别 __senderUntrusted: true + channel: string 结构", () => {
    const err = { __senderUntrusted: true, channel: "prompt", ok: false };
    expect(isSenderUntrustedError(err)).toBe(true);
  });

  it("拒绝普通 Error (无 __senderUntrusted tag)", () => {
    expect(isSenderUntrustedError(new Error("业务错误"))).toBe(false);
    expect(isSenderUntrustedError(new Error("IPC 调用来源不受信任"))).toBe(false);
  });

  it("拒绝 null / undefined / 字符串", () => {
    expect(isSenderUntrustedError(null)).toBe(false);
    expect(isSenderUntrustedError(undefined)).toBe(false);
    expect(isSenderUntrustedError("error")).toBe(false);
  });

  it("拒绝 tag 在但 channel 不是 string", () => {
    expect(isSenderUntrustedError({ __senderUntrusted: true, channel: 123, ok: false })).toBe(false);
    expect(isSenderUntrustedError({ __senderUntrusted: true, ok: false })).toBe(false);
  });

  it("拒绝 __senderUntrusted 不是 boolean true", () => {
    expect(isSenderUntrustedError({ __senderUntrusted: "yes", channel: "x", ok: false })).toBe(false);
    expect(isSenderUntrustedError({ __senderUntrusted: false, channel: "x", ok: false })).toBe(false);
  });
});

describe("makeSenderUntrustedError 工厂 (issue #65 主题 H)", () => {
  it("构造的契约对象能被 typeguard 识别, 且含 ok: false (union narrowing 兼容)", () => {
    const err = makeSenderUntrustedError(IPC_CHANNELS.prompt);
    expect(isSenderUntrustedError(err)).toBe(true);
    expect(err.__senderUntrusted).toBe(true);
    expect(err.channel).toBe(IPC_CHANNELS.prompt);
    expect(err.ok).toBe(false);
  });
});

describe("IpcInvokeResult<K> 派生契约 (issue #65 主题 H)", () => {
  it("IpcInvokeResult<channel> 联合类型含 SenderUntrustedError 变体", () => {
    // 编译期检查: IpcInvokeResult<K] = Awaited<ReturnType<IpcInvokeMap[K]>> | SenderUntrustedError
    // 下面变量在编译期不报错即可证明 union 成立.
    type PromptResultFromMap = IpcInvokeResult<"prompt">;
    const trusted: PromptResultFromMap = {
      ok: true,
      turnId: "t",
    } as PromptResultFromMap;
    const untrusted: PromptResultFromMap = makeSenderUntrustedError("prompt");
    // 显式 narrowing 验: typeguard 后 channel 字段可读
    if (isSenderUntrustedError(untrusted)) {
      expect(untrusted.channel).toBe("prompt");
    } else {
      // 走 resolve 路径, 应该是 PromptResult 类型
      expect((trusted as { ok: boolean }).ok).toBe(true);
    }
  });
});

/**
 * Helper: register a handler in a captured `calls` list, return the wrapped
 * handler so tests can drive it directly. Mirrors what `ipcMain.handle`
 * actually does at runtime (calls the wrap function with the event and args).
 */
function registerAndCapture<K extends keyof typeof IPC_CHANNELS>(
  channel: K,
  handler: (...args: unknown[]) => unknown,
): (e: unknown, ...args: unknown[]) => unknown {
  const calls: Array<[string, (...args: unknown[]) => unknown]> = [];
  const ipcMain = {
    handle: vi.fn((c: string, f: never) => calls.push([c, f])),
  };
  handle(
    ipcMain as never,
    channel,
    handler as never,
  );
  expect(calls).toHaveLength(1);
  return calls[0]![1];
}

describe("sender guard 集成 (issue #65 主题 H)", () => {
  it("不可信 sender 抛 SenderUntrustedError 契约, handler 不被调", async () => {
    // mock 主窗口: 真实 webContents 与事件 senderFrame 不匹配
    const trustedWebContents = { id: 1 };
    const fakeWin = { webContents: trustedWebContents, isDestroyed: () => false };
    configureIpcSenderGuard(() => fakeWin as never, null);

    const handler = vi.fn(async () => ({ ok: true }));
    const registered = registerAndCapture(IPC_CHANNELS.prompt, handler);

    // mock 不可信 sender: 不同的 webContents 引用
    const untrustedEvent = {
      sender: { id: 999 }, // 不同于 fakeWin.webContents (引用)
      senderFrame: { url: "file:///something" },
    };
    let caught: unknown;
    try {
      await (registered as (e: unknown) => Promise<unknown>)(untrustedEvent);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(isSenderUntrustedError(caught)).toBe(true);
    if (isSenderUntrustedError(caught)) {
      expect(caught.__senderUntrusted).toBe(true);
      expect(caught.channel).toBe(IPC_CHANNELS.prompt);
      // ok: false 字段是 union narrowing 兼容的基础
      expect(caught.ok).toBe(false);
    }
    expect(handler).not.toHaveBeenCalled();

    // 清理 guard — 重置 module 单例回 unconfigured
    resetIpcSenderGuard();
  });

  it("未配置 guard 时所有 sender 都通过 (测试环境默认)", async () => {
    // 把 trustedWindowProvider 显式重置回 null, 走 isTrustedIpcSender
    // 第一行 `if (!trustedWindowProvider) return true;` 短路 — 这是
    // register-ipc.ts 模块加载时默认值, 测试间 module 单例需要 reset.
    // 导出 resetIpcSenderGuard 测试 hook 来支持.
    resetIpcSenderGuard();

    const handler = vi.fn(async () => ({ ok: true }));
    const registered = registerAndCapture(IPC_CHANNELS.setModel, handler);

    const trustedEvent = {
      sender: { id: 999 },
      senderFrame: { url: "file:///index.html" },
    };
    const result = await (registered as (e: unknown) => Promise<unknown>)(
      trustedEvent,
      "provider",
      "model",
    );
    expect(result).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("主窗口被销毁时 sender 不可信 (sender guard 拒)", async () => {
    // mock 主窗口已销毁
    const fakeWebContents = { id: 1 };
    const fakeWin = { webContents: fakeWebContents, isDestroyed: () => true };
    configureIpcSenderGuard(() => fakeWin as never, null);

    const handler = vi.fn(async () => ({ ok: true }));
    const registered = registerAndCapture(IPC_CHANNELS.getStatus, handler);

    const event = {
      sender: fakeWebContents, // 引用同一个 webContents, 但窗口已销毁
      senderFrame: { url: "file:///index.html" },
    };
    let caught: unknown;
    try {
      await (registered as (e: unknown) => Promise<unknown>)(event);
    } catch (e) {
      caught = e;
    }
    expect(isSenderUntrustedError(caught)).toBe(true);
    expect(handler).not.toHaveBeenCalled();

    resetIpcSenderGuard();
  });

  it("getMainWindow() 返回 null 时 sender 不可信 (启动前窗口未就绪)", async () => {
    configureIpcSenderGuard(() => null, null);

    const handler = vi.fn(async () => ({ ok: true }));
    const registered = registerAndCapture(IPC_CHANNELS.getPrefs, handler);

    const event = {
      sender: { id: 1 },
      senderFrame: { url: "file:///index.html" },
    };
    let caught: unknown;
    try {
      await (registered as (e: unknown) => Promise<unknown>)(event);
    } catch (e) {
      caught = e;
    }
    expect(isSenderUntrustedError(caught)).toBe(true);
    expect(handler).not.toHaveBeenCalled();

    resetIpcSenderGuard();
  });

  it("dev 模式 rendererUrl 配 origin 后, 跨 origin frame 拒", async () => {
    // dev 模式: 配置 renderer origin = http://localhost:5173
    const fakeWebContents = { id: 1 };
    const fakeWin = { webContents: fakeWebContents, isDestroyed: () => false };
    configureIpcSenderGuard(() => fakeWin as never, "http://localhost:5173");

    const handler = vi.fn(async () => ({ ok: true }));
    const registered = registerAndCapture(IPC_CHANNELS.listModels, handler);

    // event 来自不同 origin
    const crossOriginEvent = {
      sender: fakeWebContents,
      senderFrame: { url: "https://evil.example.com/page" },
    };
    let caught: unknown;
    try {
      await (registered as (e: unknown) => Promise<unknown>)(crossOriginEvent);
    } catch (e) {
      caught = e;
    }
    expect(isSenderUntrustedError(caught)).toBe(true);
    expect(handler).not.toHaveBeenCalled();

    resetIpcSenderGuard();
  });

  it("dev 模式 origin 匹配时放行 (sender guard 通过)", async () => {
    // sender 与 win.webContents 必须是同一个对象引用 (isTrustedIpcSender 用 !== 比较)
    const fakeWebContents = { id: 1 };
    const fakeWin = { webContents: fakeWebContents, isDestroyed: () => false };
    configureIpcSenderGuard(() => fakeWin as never, "http://localhost:5173");

    const handler = vi.fn(async () => ({ ok: true, models: [] }));
    const registered = registerAndCapture(IPC_CHANNELS.listModels, handler);

    const event = {
      sender: fakeWebContents,
      senderFrame: { url: "http://localhost:5173/index.html" },
    };
    const result = await (registered as (e: unknown) => Promise<unknown>)(event);
    expect(result).toEqual({ ok: true, models: [] });
    expect(handler).toHaveBeenCalledOnce();

    resetIpcSenderGuard();
  });

  it("senderFrame URL 解析失败 (非 http / file: 协议) 拒", async () => {
    const fakeWebContents = { id: 1 };
    const fakeWin = { webContents: fakeWebContents, isDestroyed: () => false };
    configureIpcSenderGuard(() => fakeWin as never, null);

    const handler = vi.fn(async () => ({ ok: true }));
    const registered = registerAndCapture(IPC_CHANNELS.getStatus, handler);

    // 一个非 http/file 的 URL, URL 解析会抛, catch 块返回 false
    const event = {
      sender: fakeWebContents,
      senderFrame: { url: "chrome-extension://abcdef/popup.html" },
    };
    let caught: unknown;
    try {
      await (registered as (e: unknown) => Promise<unknown>)(event);
    } catch (e) {
      caught = e;
    }
    // chrome-extension 是有效 URL, protocol 不是 file: → 拒
    expect(isSenderUntrustedError(caught)).toBe(true);
    expect(handler).not.toHaveBeenCalled();

    resetIpcSenderGuard();
  });
});
