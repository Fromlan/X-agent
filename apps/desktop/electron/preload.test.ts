/**
 * preload 跨进程 sender-trust 透传契约测试 (issue #65 主题 H, 2026-08-31,
 * #2 flat-API 收尾, 2026-09-08).
 *
 * 验证: 不可信 sender 在 main 端抛出 `SenderUntrustedError` 后, 走
 * `ipcRenderer.invoke(channel, ...args)` 的 reject 路径, 透传到 renderer
 * 端 `await` 的 catch 块, 不被 forwarder wrap 吞掉. 渲染端能用
 * `isSenderUntrustedError(e)` typeguard 识别.
 *
 * 2026-09-08 (issue #2): flat surface 已删, 所有 invoke 都走 facade 调.
 * 之前测 revealInFolder 走 flat 的用例换成 files.reveal (新 facade).
 *
 * 这条契约的脆弱点: 一旦 forwarder 内部 `try { ... } catch (e) { throw new Error(...) }`,
 * SenderUntrustedError 的 `__senderUntrusted` tag + `channel` 字段都会丢,
 * 渲染端退化到不能区分 sender 不可信 vs 业务错误. 下面的测试用 mock
 * `ipcRenderer.invoke` 模拟 main 端拒绝, 抓 preload forwarder 的 reject
 * payload 直接断言.
 */
import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";

// vi.hoisted 让 mock refs 在 vitest hoisting 阶段就创建, vi.mock 工厂能闭包引用.
const { mockApi, getExposedXAgent, getInvokeMock } = vi.hoisted(() => {
  // 持久 expose 容器 — 用闭包 module 变量直接缓存 exposeInMainWorld
  // 第二个参数, 绕开 vitest 5 的 per-test mock 自动 reset. preload 的
  // top-level 副作用只在 import 时跑一次, 我们要拿的就是那一次的结果.
  const captured = new Map<string, unknown>();
  const invokeMock = vi.fn();
  return {
    mockApi: () => ({
      contextBridge: {
        exposeInMainWorld: (key: string, value: unknown) => {
          captured.set(key, value);
        },
      },
      ipcRenderer: {
        invoke: (...args: unknown[]) => invokeMock(...args),
        on: () => () => undefined,
        removeListener: () => undefined,
      },
    }),
    getExposedXAgent: () => {
      const v = captured.get("xAgent");
      if (!v) {
        throw new Error("preload.ts not yet loaded — exposeInMainWorld not called");
      }
      return v as Record<string, unknown>;
    },
    getInvokeMock: () => invokeMock,
  };
});

vi.mock("electron", () => mockApi());

// import 放在 vi.mock 之后, 让 vitest 抬高 mock 优先.
import { isSenderUntrustedError } from "../shared/ipc";
import { makeSenderUntrustedError } from "./ipc/register-ipc";
import { IPC_CHANNELS } from "../shared/ipc-channels";

// 触发 preload 模块的 top-level 副作用: exposeInMainWorld("xAgent", exposed).
// 这里 import 即可触发. 必须在 vi.mock 之后 import.
import "./preload";

interface ExposedXAgent {
  files: { reveal: (path: string) => Promise<unknown> };
  workspace: { open: (...args: unknown[]) => Promise<unknown> };
  turn: { prompt: (...args: unknown[]) => Promise<unknown> };
  session: { setModel: (...args: unknown[]) => Promise<unknown> };
  onEvent: (handler: (event: unknown) => void) => () => void;
  notifyAppReady: () => Promise<unknown>;
}

describe("preload forwarder (issue #65 主题 H sender-trust 透传)", () => {
  let exposed: ExposedXAgent;
  let invoke: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    exposed = getExposedXAgent() as ExposedXAgent;
    invoke = getInvokeMock();
  });

  beforeEach(() => {
    // per-test 隔离: invoke mock 状态重置
    invoke.mockReset();
  });

  it("turn.prompt forwarder 把 ipcRenderer.invoke 的 reject 原样透传 (不被 wrap)", async () => {
    // 模拟 main 端 sender guard 拒 — reject 携带 SenderUntrustedError 契约
    const rejection = makeSenderUntrustedError(IPC_CHANNELS.prompt);
    invoke.mockRejectedValueOnce(rejection);

    let caught: unknown;
    try {
      await exposed.turn.prompt({ text: "hi" } as never);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    expect(isSenderUntrustedError(caught)).toBe(true);
    if (isSenderUntrustedError(caught)) {
      expect(caught.channel).toBe(IPC_CHANNELS.prompt);
      expect(caught.ok).toBe(false);
      // __senderUntrusted tag 必须保留 — 这是 forwarder 不 wrap 的证据
      expect(caught.__senderUntrusted).toBe(true);
    }

    // 确认 forwarder 调对了 channel + payload
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.prompt, { text: "hi" });
  });

  it("forwarder resolve 路径透传业务 Result (不污染 ok 字段)", async () => {
    const businessResult = { ok: true, cwd: "/proj", sessionId: "s1" };
    invoke.mockResolvedValueOnce(businessResult);

    const result = await exposed.workspace.open("/proj", "code" as never);
    expect(result).toBe(businessResult);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.openProject, "/proj", "code");
  });

  it("业务错误 reject 也透传 (不被 forwarder 吞掉)", async () => {
    const businessError = new Error("业务错误: cwd 不存在");
    invoke.mockRejectedValueOnce(businessError);

    let caught: unknown;
    try {
      await exposed.session.setModel("provider-x", "model-y");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(businessError);
    // 业务错误不应该是 SenderUntrustedError
    expect(isSenderUntrustedError(caught)).toBe(false);
  });

  it("SenderUntrustedError 在多个 channel 上都一致透传 (调 files.reveal)", async () => {
    // 验证契约不只对 prompt channel 生效, 任意 channel 拒时都一致
    // 用 files.reveal (issue #2 新 facade) 走 facade forwarder
    const rejection = makeSenderUntrustedError(IPC_CHANNELS.revealInFolder);
    invoke.mockRejectedValueOnce(rejection);

    let caught: unknown;
    try {
      await exposed.files.reveal("README.md");
    } catch (e) {
      caught = e;
    }
    expect(isSenderUntrustedError(caught)).toBe(true);
    if (isSenderUntrustedError(caught)) {
      expect(caught.channel).toBe(IPC_CHANNELS.revealInFolder);
    }
  });
});

describe("preload surface (issue #2 flat-API 收尾)", () => {
  let exposed: ExposedXAgent;

  beforeAll(() => {
    exposed = getExposedXAgent() as ExposedXAgent;
  });

  it("顶层只 expose 14 个 facade + onEvent + notifyAppReady, 没有 flat surface", () => {
    const expectedFacades = [
      "workspace",
      "turn",
      "plan",
      "session",
      "prefs",
      "appReport",
      "godot",
      "updates",
      "logo",
      "files",
      "provider",
      "plugin",
      "package",
      "usage",
    ];
    for (const name of expectedFacades) {
      expect(exposed[name], `facade ${name} 应该暴露`).toBeDefined();
      expect(typeof exposed[name]).toBe("object");
    }
    expect(typeof exposed.onEvent).toBe("function");
    expect(typeof exposed.notifyAppReady).toBe("function");
  });

  it("不存在 flat IPC channel 顶层方法 (issue #2 收尾)", () => {
    // 老 flat surface 方法都不应再出现: prompt / setModel / openProject / ...
    // 渲染端必须走 facade, 顶层除了 onEvent + notifyAppReady 不应有别的 invoke 方法.
    const flatForbidden = [
      "prompt",
      "abort",
      "openProject",
      "newSession",
      "getStatus",
      "setModel",
      "getSessionUsage",
      "compactSession",
      "setSessionMode",
      "getSessionMode",
      "getPrefsRecoveryNotice",
      "getSecretCodecStatus",
      "applyBashShellPath",
      "pickBashShell",
      "installPiCli",
      "openPiLogin",
      "openExternalUrl",
      "listProjectDir",
      "readProjectFile",
      "revealInFolder",
      "godotRpcStatus",
      "godotRpcStart",
      "godotRpcStop",
      "godotRpcPing",
      "godotRpcRequest",
      "godotRpcSetActiveClient",
      "installGodotRpcAddon",
      "launchGodotEditor",
      "pickGodotEditor",
      "pickGodotScene",
      "listPlugins",
      "readPlugin",
      "writePlugin",
      "createPlugin",
      "deletePlugin",
      "revealPlugin",
      "listInstalledPackages",
      "installPackage",
      "uninstallPackage",
      "installGodotPiPackage",
      "getUsageSummary",
      "clearUsageSummary",
      "listProviderProfiles",
      "getProviderProfile",
      "upsertProviderProfile",
      "deleteProviderProfile",
      "setProviderProfileEnabled",
      "listProviderPresets",
      "importExistingProviderProfiles",
      "fetchProviderModels",
      "setThinkingLevel",
      "listModels",
      "getToolDetail",
      "reloadResources",
      "listSessionSlashItems",
      "getPrefs",
      "setPrefs",
      "checkBash",
      "checkBashLiveness",
      "checkGit",
      "checkAuth",
      "checkPiCli",
      "listSessions",
      "resumeSession",
      "deleteSession",
      "deleteProjectSessions",
      "renameSession",
      "closeWorkspace",
      "getUpdateStatus",
      "checkForUpdates",
      "downloadUpdate",
      "installUpdate",
      "logoListPresets",
      "logoUploadCustom",
      "logoClearCustom",
      "listSessionSlashItems",
      "listProjectDir",
      "readProjectFile",
      "revealInFolder",
    ];
    for (const name of flatForbidden) {
      expect(
        (exposed as unknown as Record<string, unknown>)[name],
        `flat method ${name} 不应再出现在顶层`,
      ).toBeUndefined();
    }
  });

  it("14 个 facade 都有正确的方法 (smoke)", () => {
    // 锁住 facade 形态, 防止以后漏加新方法或拼错名字
    expect(Object.keys(exposed.workspace).sort()).toEqual([
      "close",
      "deleteProjectSessions",
      "deleteSession",
      "getStatus",
      "listSessions",
      "newSession",
      "open",
      "renameSession",
      "resume",
    ]);
    expect(Object.keys(exposed.turn).sort()).toEqual([
      "abort",
      "editAndResend",
      "previewRetract",
      "prompt",
      "regenerate",
      "retract",
    ]);
    expect(Object.keys(exposed.files).sort()).toEqual([
      "list",
      "openExternal",
      "read",
      "reveal",
    ]);
    expect(Object.keys(exposed.provider).sort()).toEqual([
      "deleteProfile",
      "fetchModels",
      "getProfile",
      "importExisting",
      "listPresets",
      "listProfiles",
      "login",
      "setProfileEnabled",
      "upsertProfile",
    ]);
    expect(Object.keys(exposed.plugin).sort()).toEqual([
      "create",
      "delete",
      "list",
      "read",
      "reveal",
      "write",
    ]);
    expect(Object.keys(exposed.package).sort()).toEqual([
      "install",
      "installGodotPi",
      "list",
      "uninstall",
    ]);
    expect(Object.keys(exposed.usage).sort()).toEqual([
      "clearSummary",
      "getSummary",
    ]);
  });
});
