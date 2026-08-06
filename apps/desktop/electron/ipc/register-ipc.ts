import type { IpcMain, IpcMainInvokeEvent } from "electron";
import type { IpcInvokeMap, IpcChannelKey } from "../../shared/ipc";

/**
 * Typed `ipcMain.handle` registrar: the handler signature is derived from
 * IpcInvokeMap, so the main-process side and the preload side share one
 * authoritative signature per channel (no drift possible).
 */
export type IpcHandler<K extends IpcChannelKey> = IpcInvokeMap[K] extends (
  ...args: infer Args
) => Promise<infer Result>
  ? (event: IpcMainInvokeEvent, ...args: Args) => Promise<Result> | Result
  : never;

/** Register one invoke handler with its signature anchored to IpcInvokeMap. */
export function handle<K extends IpcChannelKey>(
  ipcMain: IpcMain,
  channel: K,
  handler: IpcHandler<K>,
): void {
  ipcMain.handle(channel, handler as never);
}
