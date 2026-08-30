/**
 * 一键诊断:列出当前 model + 视觉能力 (input 字段)。
 *
 * 背景:mistral-conversations provider 在 model.input 不含 "image" 时,
 * 会把整条 user message 替换为 "(image omitted: model does not support
 * images)" 占位文本 —— 表现是"截图已发但 AI 看不到"。X-agent 96fef06
 * commit 已把 input 字段透传到 renderer + 加 send 闸门。本脚本是
 * 配套诊断工具,让用户在不开 DevTools 的情况下看清楚当前 model 配置。
 *
 * 用法:
 *   cd apps/desktop && npx tsx scripts/diag-model-image-support.ts
 *
 * 退出码:
 *   0  当前 model 支持 image (input 含 "image")
 *   1  当前 model 不支持 image (input 是 ["text"] 或 undefined)
 *   2  还没打开项目 / 没有任何 model
 */
import { SessionHost } from "../electron/agent/session-host";
import { getCachedPrefs } from "../electron/agent/prefs";

async function main() {
  const prefs = getCachedPrefs();
  if (!prefs.provider || !prefs.model) {
    console.log("[diag-model-image-support] no provider/model in prefs");
    console.log("  open a project first, then re-run");
    process.exit(2);
  }
  const currentKey = `${prefs.provider}/${prefs.model}`;
  console.log(`[diag-model-image-support] current model: ${currentKey}`);
  console.log(`[diag-model-image-support] cwd: ${prefs.lastProjectPath ?? "(none)"}`);
  console.log();

  // 通过 listModels 拿到所有 model 的 input 字段
  // 没法直接拿 SessionHost 实例 (没构造 cwd), 走 standalone listModels
  // 不行, listModels 依赖 this.bundle。我们用更轻的方式:
  // 从 ~/.pi/agent/models.json + bundled data 反推 input。
  // 实际场景:用户最常问"我用的模型到底收不收图",在 vendor models.json 里查最直接。
  // fallback: listModels 的同名函数 (通过 runtime.getAvailable)。

  console.log("[diag-model-image-support] Pi SDK bundled model list (filtered to current):");
  const models = await getBundledModels();
  const found = models.find(
    (m) => m.provider === prefs.provider && m.id === prefs.model,
  );
  if (!found) {
    console.log(
      `  ! current model ${currentKey} NOT FOUND in bundled data`,
    );
    console.log(
      "    -> 你可能用了 ~/.pi/agent/models.json 里的自定义模型,或 Pi SDK bundled data 缺失",
    );
    console.log("    -> 这种情况:send 闸门会按 input=undefined 保守按'不收图'对待");
    process.exit(1);
  }
  const input = found.input;
  console.log(`  provider:    ${found.provider}`);
  console.log(`  id:          ${found.id}`);
  console.log(`  input:       ${JSON.stringify(input)}`);
  console.log(
    `  image input: ${Array.isArray(input) && input.includes("image") ? "✅ 是" : "❌ 否"}`,
  );
  console.log();
  if (!Array.isArray(input) || !input.includes("image")) {
    console.log("[diag-model-image-support] 当前 model 不收图,会触发 Pi SDK 静默丢图。");
    console.log("  修法:");
    console.log("  - 切到 vision Mistral: mistral-small-2603 / pixtral-12b / mistral-medium-latest");
    console.log("  - 或换 provider: Anthropic / OpenAI GPT-4o / Gemini");
    console.log("  - 或 ~/.pi/agent/models.json 里把 input 改成 [\"text\", \"image\"] (治标不治本)");
    process.exit(1);
  }
  process.exit(0);
}

// === bundled MODELS 导入 (从 @earendil-works/pi-ai/dist) ===
// 复用 SessionHost 同样的 runtime,避免在 listModels 没 bundle 时报空。
import { ModelRuntime, getAgentDir } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { homedir } from "node:os";

async function getBundledModels() {
  const authPath = join(homedir(), ".pi", "agent", "auth.json");
  const modelsPath = join(homedir(), ".pi", "agent", "models.json");
  const agentDir = getAgentDir();
  const runtime = await ModelRuntime.create({ authPath, modelsPath });
  const available = await runtime.getAvailable();
  return available;
}

main().catch((err) => {
  console.error("[diag-model-image-support] failed:", err);
  process.exit(2);
});
