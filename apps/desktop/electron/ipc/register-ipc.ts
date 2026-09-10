import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent,
} from "electron";
import {
  type IpcInvokeMap,
  type IpcChannelKey,
  type SenderUntrustedError,
} from "../../shared/ipc";
import { inspectError } from "../../shared/error-i18n";
import { dbgWarn } from "../../shared/debug-log";

/**
 * Typed `ipcMain.handle` registrar: the handler signature is derived from
 * IpcInvokeMap, so the main-process side and the preload side share one
 * authoritative signature per channel (no drift possible).
 *
 * Every handler is wrapped with a sender trust check (defense in depth):
 * only the main window's webContents (and a frame whose origin matches the
 * renderer URL / file: protocol) may invoke channels.
 *
 * **Sender-trust 契约 (issue #65 主题 H, 2026-08-31)**:
 *  - 不可信 sender 抛 `SenderUntrustedError`, IPC 协议让该 throw 透传到
 *    renderer 端 `await` 的 reject 路径, 渲染端 catch 块拿到
 *    `SenderUntrustedError` 对象, 可用 `isSenderUntrustedError` typeguard
 *    区分业务错误.
 *  - 这个 throw 不会进 IpcInvokeMap[K] 的 resolve union, 因为 TS Promise
 *    resolve 路径不携带 throw 类型. 协议层契约用派生类型 `IpcInvokeResult<K>`
 *    表达 (详见 ./../../shared/ipc-invoke-map.ts).
 *  - `SenderUntrustedError` 字段 `ok: false` 让 `Result | SenderUntrustedError`
 *    union 在 `if (!result.ok)` narrowing 时仍然 work.
 *
 * **Handler-throw 翻译 (阶段 3, 2026-09-09)**:
 *  - 业务错误继续走 `Result` (返回 `{ ok: false, error }`, session-host 等
 *    已经在 main 里产出中文 message).
 *  - handler 自身 `throw` 的非 sender-untrusted 错误会被 `inspectError` 翻译
 *    成中文 + `patternId`, 然后以 `TranslatedIpcError` 形态抛回 renderer. 这样
 *    renderer catch 块既能拿到用户面中文, 也能用 `isTranslatedIpcError` 区分.
 */
export type IpcHandler<K extends IpcChannelKey> = IpcInvokeMap[K] extends (
  ...args: infer Args
) => Promise<infer Result>
  ? (event: IpcMainInvokeEvent, ...args: Args) => Promise<Result> | Result
  : never;

/**
 * Marker the renderer can use to tell a translated handler error apart from
 * `SenderUntrustedError` and from raw upstream `Error.message` strings.
 */
export type TranslatedIpcError = {
  __translatedError: true;
  patternId: string | null;
  message: string;
};

/** Typeguard matching the marker above. */
export function isTranslatedIpcError(err: unknown): err is TranslatedIpcError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { __translatedError?: unknown }).__translatedError === true
  );
}

let trustedWindowProvider: (() => BrowserWindow | null) | null = null;
let trustedRendererOrigin: string | null = null;

/**
 * 配置 IPC sender 守卫（app-runtime 启动时调用一次）。
 * - `getMainWindow`：主窗口提供者；为 null 时视为未配置（测试环境跳过校验）。
 * - `rendererUrl`：dev 模式 renderer URL（origin 匹配用）；null 表示打包态（file:）。
 */
export function configureIpcSenderGuard(
  getMainWindow: () => BrowserWindow | null,
  rendererUrl: string | null,
): void {
  trustedWindowProvider = getMainWindow;
  try {
    trustedRendererOrigin = rendererUrl ? new URL(rendererUrl).origin : null;
  } catch {
    trustedRendererOrigin = null;
  }
}

/**
 * 把 sender guard 内部状态重置回 "unconfigured" (issue #65 主题 H 测试 hook).
 * 仅供单元测试在 case 间复位 module 单例, 不在生产代码使用.
 */
export function resetIpcSenderGuard(): void {
  trustedWindowProvider = null;
  trustedRendererOrigin = null;
}

/** 来源是否可信：主窗口 webContents + frame URL 属于应用自身。 */
function isTrustedIpcSender(event: IpcMainInvokeEvent): boolean {
  if (!trustedWindowProvider) return true; // guard 未配置（离线测试）
  const win = trustedWindowProvider();
  if (!win || win.isDestroyed()) return false;
  if (event?.sender !== win.webContents) return false;
  const frameUrl = event.senderFrame?.url;
  if (!frameUrl) return false;
  try {
    const frame = new URL(frameUrl);
    if (trustedRendererOrigin) return frame.origin === trustedRendererOrigin;
    return frame.protocol === "file:";
  } catch {
    return false;
  }
}

/**
 * 构造不可信 sender 异常 (issue #65 主题 H, 2026-08-31). 导出供测试与未来
 * sender-guard 旁路 (例如诊断模式) 共用. `ok: false` 字段让 union narrowing
 * 兼容.
 */
export function makeSenderUntrustedError(channel: string): SenderUntrustedError {
  return {
    __senderUntrusted: true,
    channel,
    ok: false,
  };
}

/**
 * Register one invoke handler with its signature anchored to IpcInvokeMap.
 *
 *  - Sender-trust check runs first; untrusted senders throw `SenderUntrustedError`.
 *  - Any other throw from the handler is funneled through `inspectError` and
 *    re-thrown as a `TranslatedIpcError` so the renderer receives a Chinese
 *    user-facing message + a stable `patternId`.
 */
export function handle<K extends IpcChannelKey>(
  ipcMain: IpcMain,
  channel: K,
  handler: IpcHandler<K>,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedIpcSender(event as IpcMainInvokeEvent)) {
      console.warn(`[ipc] 拒绝来自不受信任来源的调用：${channel}`);
      // 抛契约化异常 (issue #65 主题 H, 2026-08-31). 之前 throw new Error(...)
      // 让 renderer 端 catch 块拿到普通 Error, 无法与业务错误区分. 现在用
      // __senderUntrusted tag 让 typeguard 识别, channel 字段方便日志追踪.
      // `ok: false` 字段让 SenderUntrustedError 与业务 Result union 后 narrowing
      // 仍 work (IpcInvokeResult[K] = Result | SenderUntrustedError).
      throw makeSenderUntrustedError(channel);
    }
    try {
      return await handler(event, ...args);
    } catch (err) {
      // SenderUntrustedError is a plain object thrown above, never reaches here.
      // Translate upstream / network / model errors so the renderer receives
      // a Chinese summary + a stable patternId (see shared/error-i18n.ts).
      const inspected = inspectError(err);
      dbgWarn("ipc", `${channel} handler threw`, err);
      throw {
        __translatedError: true,
        patternId: inspected.patternId,
        message: inspected.message,
      } satisfies TranslatedIpcError;
    }
  });
}
