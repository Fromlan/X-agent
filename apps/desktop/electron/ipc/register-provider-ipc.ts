import type { IpcMain } from "electron";
import { activateProviderAndApply } from "../agent/provider-activate";
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

/** Provider / model catalog IPC. */
export function registerProviderIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
): void {
  ipcMain.handle(IPC_CHANNELS.listProviderProfiles, async () => listProviderProfiles());
  ipcMain.handle(IPC_CHANNELS.getProviderProfile, async (_e, id: string) =>
    getProviderProfile(id),
  );
  ipcMain.handle(IPC_CHANNELS.upsertProviderProfile, async (_e, input: ProviderUpsertInput) => {
    const result = await upsertProviderProfile(input);
    // Enabled sync or disabled prune both change TopBar catalog.
    if (result.ok) {
      await sessionHost.reloadRuntime({ hard: true });
    }
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.deleteProviderProfile, async (_e, id: string) => {
    const result = await deleteProviderProfile(id);
    if (result.ok) {
      await sessionHost.reloadRuntime({ hard: true });
    }
    return result;
  });
  ipcMain.handle(
    IPC_CHANNELS.setProviderProfileEnabled,
    async (_e, id: string, enabled: boolean) => {
      const result = await setProviderProfileEnabled(id, enabled);
      if (result.ok) {
        await sessionHost.reloadRuntime({ hard: true });
      }
      return result;
    },
  );
  // Compat: enable + sync + apply session model.
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
