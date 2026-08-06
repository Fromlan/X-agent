import type { IpcMain } from "electron";
import {
  deleteProviderProfile,
  getProviderProfile,
  importExistingProviderProfiles,
  listProviderPresets,
  listProviderProfiles,
  setProviderProfileEnabled,
  upsertProviderProfile,
} from "../agent/provider-store";
import { fetchProviderModels } from "../agent/model-fetch";
import type { SessionHost } from "../agent/session-host";
import type { ProviderUpsertInput } from "../../shared/ipc";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { handle } from "./register-ipc";

/** Provider / model catalog IPC. */
export function registerProviderIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
): void {
  handle(ipcMain, IPC_CHANNELS.listProviderProfiles, async () => listProviderProfiles());
  handle(ipcMain, IPC_CHANNELS.getProviderProfile, async (_e, id: string) =>
    getProviderProfile(id),
  );
  handle(
    ipcMain,
    IPC_CHANNELS.upsertProviderProfile,
    async (_e, input: ProviderUpsertInput) => {
      const result = await upsertProviderProfile(input);
      // Enabled sync or disabled prune both change TopBar catalog.
      if (result.ok) {
        await sessionHost.reloadRuntime({ hard: true });
      }
      return result;
    },
  );
  handle(ipcMain, IPC_CHANNELS.deleteProviderProfile, async (_e, id: string) => {
    const result = await deleteProviderProfile(id);
    if (result.ok) {
      await sessionHost.reloadRuntime({ hard: true });
    }
    return result;
  });
  handle(
    ipcMain,
    IPC_CHANNELS.setProviderProfileEnabled,
    async (_e, id: string, enabled: boolean) => {
      const result = await setProviderProfileEnabled(id, enabled);
      if (result.ok) {
        await sessionHost.reloadRuntime({ hard: true });
      }
      return result;
    },
  );
  handle(ipcMain, IPC_CHANNELS.listProviderPresets, async () => listProviderPresets());
  handle(ipcMain, IPC_CHANNELS.importExistingProviderProfiles, async () =>
    importExistingProviderProfiles(),
  );
  handle(
    ipcMain,
    IPC_CHANNELS.fetchProviderModels,
    async (_e, input: { baseUrl: string; apiKey: string }) =>
      fetchProviderModels(input),
  );
}
