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

/** Provider / model catalog IPC. */
export function registerProviderIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
): void {
  ipcMain.handle("listProviderProfiles", async () => listProviderProfiles());
  ipcMain.handle("getProviderProfile", async (_e, id: string) =>
    getProviderProfile(id),
  );
  ipcMain.handle("upsertProviderProfile", async (_e, input: ProviderUpsertInput) =>
    upsertProviderProfile(input),
  );
  ipcMain.handle("deleteProviderProfile", async (_e, id: string) =>
    deleteProviderProfile(id),
  );
  ipcMain.handle("activateProviderProfile", async (_e, id: string) =>
    activateProviderAndApply(id, (provider, model) =>
      sessionHost.applyActivatedProvider(provider, model),
    ),
  );
  ipcMain.handle("listProviderPresets", async () => listProviderPresets());
  ipcMain.handle("importExistingProviderProfiles", async () =>
    importExistingProviderProfiles(),
  );
  ipcMain.handle(
    "fetchProviderModels",
    async (_e, input: { baseUrl: string; apiKey: string }) =>
      fetchProviderModels(input),
  );
}
