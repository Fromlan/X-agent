/**
 * Provider store — stable barrel re-exports for callers and tests.
 */
export type { ProviderStoreFile, ProviderPaths } from "./provider-persist";
export {
  defaultProviderPaths,
  deleteProviderProfile,
  filterModelsByCatalogEnabled,
  getProviderProfile,
  isProviderEnabledInCatalog,
  listProviderProfiles,
  maskApiKey,
  setProviderProfileEnabled,
  upsertProviderProfile,
} from "./provider-persist";

export { listProviderPresets } from "./provider-presets";

export {
  activateProviderProfile,
  pruneProviderIdFromPi,
  syncProfileToPi,
} from "./provider-pi-sync";

export {
  dedupeModelInfosForUi,
  deepseekProxyModelExtras,
  isPiAutoDetectedDeepSeekEndpoint,
  looksLikeDeepSeekModelId,
  modelEntryForPiModelsJson,
  pruneStaleProviderKeys,
  repairDeepSeekModelsJson,
} from "./provider-pi-models";

export { importExistingProviderProfiles } from "./provider-import";
