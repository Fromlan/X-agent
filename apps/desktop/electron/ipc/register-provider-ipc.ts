import type { IpcMain } from "electron";
import { activateProviderAndApply } from "../agent/provider-activate";
import {
  deleteProviderProfile,
  getProviderProfile,
  importExistingProviderProfiles,
  listProviderPresets,
  listProviderProfiles,
  upsertProviderProfile,
} from "../agent/provider-store";
import { fetchProviderModels } from "../agent/model-fetch";
import type { SessionHost } from "../agent/session-host";
import type { ProviderUpsertInput } from "../../shared/ipc";
import { IPC_CHANNELS } from "../../shared/ipc-channels";

/** Provider / model catalog IPC. */
export function registerProviderIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
): void {
  ipcMain.handle(IPC_CHANNELS.listProviderProfiles, async () => listProviderProfiles());
  ipcMain.handle(IPC_CHANNELS.getProviderProfile, async (_e, id: string) =>
    getProviderProfile(id),
  );
  ipcMain.handle(IPC_CHANNELS.upsertProviderProfile, async (_e, input: ProviderUpsertInput) =>
    upsertProviderProfile(input),
  );
  ipcMain.handle(IPC_CHANNELS.deleteProviderProfile, async (_e, id: string) =>
    deleteProviderProfile(id),
  );
  ipcMain.handle(IPC_CHANNELS.activateProviderProfile, async (_e, id: string) =>
    activateProviderAndApply(id, (provider, model) =>
      sessionHost.applyActivatedProvider(provider, model),
    ),
  );
  ipcMain.handle(IPC_CHANNELS.listProviderPresets, async () => listProviderPresets());
  ipcMain.handle(IPC_CHANNELS.importExistingProviderProfiles, async () =>
    importExistingProviderProfiles(),
  );
  ipcMain.handle(
    IPC_CHANNELS.fetchProviderModels,
    async (_e, input: { baseUrl: string; apiKey: string }) =>
      fetchProviderModels(input),
  );
}
