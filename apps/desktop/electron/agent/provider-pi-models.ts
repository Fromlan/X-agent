/**
 * provider-pi-models —— Pi `models.json` 塑形 / 修复 / UI 去重 的公共入口
 * (issue #68 主题 J C-103, 2026-08-31 收口).
 *
 * 原本单文件 387 行同时承担 3 件事: 塑形 (model-shape) / 启动期隐式修复
 * (model-repair) / UI 去重 (model-ui-dedup). 拆到 ./provider-pi-models/
 * 三个 module 后, 本文件只剩 re-export, 行为零变化.
 *
 * 调用方不需要改 import: provider-pi-sync / provider-store 仍 import
 * "./provider-pi-models" 拿到所有原 export.
 */
export {
  deepseekProxyModelExtras,
  isPiAutoDetectedDeepSeekEndpoint,
  looksLikeDeepSeekModelId,
  looksLikeMiniMaxModelId,
  minimaxModelExtras,
  modelEntryForPiModelsJson,
} from "./provider-pi-models/model-shape";

export {
  repairDeepSeekModelsJson,
  repairMiniMaxModelsJson,
} from "./provider-pi-models/model-repair";

export {
  dedupeModelInfosForUi,
  pruneStaleProviderKeys,
} from "./provider-pi-models/model-ui-dedup";
