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

/**
 * Typed `ipcMain.handle` registrar: the handler signature is derived from
 * IpcInvokeMap, so the main-process side and the preload side share one
 * authoritative signature per channel (no drift possible).
 *
 * Every handler is wrapped with a sender trust check (defense in depth):
 * only the main window's webContents (and a frame whose origin matches the
 * renderer URL / file: protocol) may invoke channels.
 *
 * 不可信 sender 现在抛 `SenderUntrustedError` (issue #65 主题 H, 2026-08-31),
 * renderer 端可用 `isSenderUntrustedError` typeguard 区分. 不再加进 IpcInvokeMap[K]
 * (会让 100+ consumer 全部 typecheck 失败, 详见 SenderUntrustedError doc).
 */
export type IpcHandler<K extends IpcChannelKey> = IpcInvokeMap[K] extends (
  ...args: infer Args
) => Promise<infer Result>
  ? (event: IpcMainInvokeEvent, ...args: Args) => Promise<Result> | Result
  : never;

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

/** Register one invoke handler with its signature anchored to IpcInvokeMap. */
export function handle<K extends IpcChannelKey>(
  ipcMain: IpcMain,
  channel: K,
  handler: IpcHandler<K>,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedIpcSender(event as IpcMainInvokeEvent)) {
      console.warn(`[ipc] 拒绝来自不受信任来源的调用：${channel}`);
      // 抛契约化异常 (issue #65 主题 H, 2026-08-31). 之前 throw new Error(...)
      // 让 renderer 端 catch 块拿到普通 Error, 无法与业务错误区分. 现在用
      // __senderUntrusted tag 让 typeguard 识别, channel 字段方便日志追踪.
      const err: SenderUntrustedError = {
        __senderUntrusted: true,
        channel,
      };
      throw err;
    }
    return handler(event, ...args);
  });
}
