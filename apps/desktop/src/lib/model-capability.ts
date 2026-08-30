/**
 * Model capability helpers — 决定当前 model 是否能接收图片。
 *
 * 背景:Pi SDK 的 `mistral-conversations` provider (`pi-ai/dist/api/mistral-conversations.js:436-450`)
 * 会基于 `Model.input` 在 user message 含 image 时把整条 message
 * 替换为 `(image omitted: model does not support images)` 占位文本,
 * 造成"截图已发但 AI 看不到"。X-agent 必须在 send 前能判断当前 model
 * 是否支持 image,并在 chip 区 / send 闸门处给用户明确反馈。
 *
 * `ModelInfo.input` 来自 `listModels` 透传 Pi SDK `Model.input`:
 * - `["text"]`           纯文本 → 不支持图
 * - `["text", "image"]`  多模态 → 支持图
 * - `undefined`          未知 → 保守按"不收图"对待 (不假设支持,避免
 *                         误用不收图的模型时静默丢失图片)
 */
import type { ModelInfo } from "@shared/ipc";

/** 当前 model 是否收 image。`input === undefined` 时返回 false (保守)。 */
export function modelSupportsImage(
  models: ReadonlyArray<ModelInfo>,
  key: string | null | undefined,
): boolean {
  if (!key) return false;
  const m = models.find((x) => `${x.provider}/${x.id}` === key);
  if (!m) return false;
  return Array.isArray(m.input) && m.input.includes("image");
}

/**
 * 拿当前 model 的完整 ModelInfo(给 chip 提示文案用)。
 * 返回 null 表示未选中 / 不在 listModels 列表中。
 */
export function findCurrentModel(
  models: ReadonlyArray<ModelInfo>,
  key: string | null | undefined,
): ModelInfo | null {
  if (!key) return null;
  return models.find((x) => `${x.provider}/${x.id}` === key) ?? null;
}
