import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// NOTE: pi-coding-agent 的 package.json 限制了 exports，无法直接 import
// `@earendil-works/pi-coding-agent/dist/...` 子路径。
// 这里改成相对 node_modules 的文件路径导入，以便离线测量脚本可运行。
import { buildSystemPrompt } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js";
import {
  createAllToolDefinitions,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/index.js";

import {
  AVAILABLE_TOOLS,
  ALL_TOGGLEABLE_TOOLS,
  GODOT_TOOLS,
  WEB_TOOLS,
} from "../shared/ipc";
import { createGodotTools } from "../electron/agent/godot-tools";
import { createDeepSeekWebTools } from "../electron/agent/deepseek-web-tools";
import type { GodotRpcBridge } from "../electron/agent/godot-rpc-bridge";

import { estimateTextTokens } from "../electron/agent/context-breakdown";
import { SessionModeController } from "../electron/agent/session-mode/controller";

type ToolDefLike = {
  name: string;
  description?: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters?: unknown;
};

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function toolDefsByName(toolDefs: ToolDefLike[]): Record<string, ToolDefLike> {
  return Object.fromEntries(toolDefs.map((d) => [d.name, d]));
}

function buildToolSnippetsAndGuidelines(
  toolNames: readonly string[],
  defsByName: Record<string, ToolDefLike>,
): {
  toolSnippets: Record<string, string>;
  promptGuidelines: string[];
} {
  const toolSnippets: Record<string, string> = {};
  const promptGuidelines: string[] = [];
  for (const name of toolNames) {
    const def = defsByName[name];
    if (!def) continue;
    if (def.promptSnippet) toolSnippets[name] = def.promptSnippet;
    if (def.promptGuidelines?.length) {
      promptGuidelines.push(...def.promptGuidelines);
    }
  }
  return { toolSnippets, promptGuidelines };
}

function estimateSchemaTokens(toolNames: readonly string[], defsByName: Record<string, ToolDefLike>): number {
  let totalChars = 0;
  for (const name of toolNames) {
    const def = defsByName[name];
    if (!def) continue;
    totalChars += safeStringify({
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    }).length;
  }
  return totalChars <= 0 ? 0 : Math.ceil(totalChars / 4);
}

function estimateSystemTokens(opts: {
  cwd: string;
  toolNames: readonly string[];
  defsByName: Record<string, ToolDefLike>;
  appendSystemPrompt?: string;
}): number {
  const { toolSnippets, promptGuidelines } =
    buildToolSnippetsAndGuidelines(opts.toolNames, opts.defsByName);

  const systemPrompt = buildSystemPrompt({
    selectedTools: [...opts.toolNames],
    toolSnippets,
    promptGuidelines,
    cwd: opts.cwd,
    contextFiles: [],
    skills: [],
    appendSystemPrompt: opts.appendSystemPrompt,
  });
  return estimateTextTokens(systemPrompt);
}

async function main(): Promise<void> {
  // Stable repo root so system prompt "Current working directory" is stable.
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const cwd = join(repoRoot, "apps", "desktop");

  // Built-in tool definitions (Pi local toolset).
  const builtins = createAllToolDefinitions(cwd, {
    read: { autoResizeImages: false },
    bash: { shellPath: "bash" },
  });
  const builtinDefs = Object.values(builtins) as ToolDefLike[];
  const builtinByName = toolDefsByName(builtinDefs);

  // Godot tools: only need definitions; execution never happens in this script.
  const dummyBridge = {
    async request() {
      throw new Error("dummy bridge: tool execution is disabled in baseline script");
    },
  } as unknown as GodotRpcBridge;
  const godotEditorDefs = createGodotTools(dummyBridge) as unknown as ToolDefLike[];
  const godotByName = toolDefsByName(godotEditorDefs);

  const defsByName: Record<string, ToolDefLike> = {
    ...builtinByName,
    ...godotByName,
    ...toolDefsByName(createDeepSeekWebTools()),
  };

  const tools7 = [...AVAILABLE_TOOLS];
  const toolsAll = [...ALL_TOGGLEABLE_TOOLS];

  assert(
    tools7.length === 7,
    `sanity: AVAILABLE_TOOLS length should be 7, got ${tools7.length}`,
  );
  assert(
    toolsAll.length === 7 + WEB_TOOLS.length + GODOT_TOOLS.length,
    `sanity: ALL_TOGGLEABLE_TOOLS length should be ${7 + WEB_TOOLS.length + GODOT_TOOLS.length}, got ${toolsAll.length}`,
  );

  const system7 = estimateSystemTokens({ cwd, toolNames: tools7, defsByName });
  const systemAll = estimateSystemTokens({ cwd, toolNames: toolsAll, defsByName });
  // Exercise the real app composer without a live session or user resources.
  const controller = new SessionModeController(() => {
    throw new Error("baseline composition must not access a live session");
  });
  const codeAppend = controller.composeModeAppend([], "code", "agent").join("\n\n");
  const designAppend = controller.composeModeAppend([], "design", "agent").join("\n\n");
  const systemCode = estimateSystemTokens({ cwd, toolNames: tools7, defsByName, appendSystemPrompt: codeAppend });
  const systemDesign = estimateSystemTokens({ cwd, toolNames: tools7, defsByName, appendSystemPrompt: designAppend });
  const codeAppendTokens = systemCode - system7;
  const designAppendTokens = systemDesign - system7;
  assert(codeAppendTokens > 0 && codeAppendTokens <= 1_100,
    `code session app append exceeds budget: ${codeAppendTokens}`);
  assert(designAppendTokens >= codeAppendTokens && designAppendTokens <= 1_900,
    `design session app append exceeds budget: ${designAppendTokens}`);
  // Schema estimation doesn't need the system prompt; keep it separate so deltas
  // explain whether the payload bloat comes from "tool schemas" vs "system".
  const schemaTokens7 = estimateSchemaTokens(tools7, defsByName);
  const schemaTokensAll = estimateSchemaTokens(toolsAll, defsByName);

  const total7 = system7 + schemaTokens7;
  const totalAll = systemAll + schemaTokensAll;
  const delta = totalAll - total7;

  // "Expected" here is intentionally loose: we only want a regression guard.
  assert(
    delta >= 400,
    `baseline delta too small (expected >=400): delta=${delta}, total7=${total7}, totalAll=${totalAll}`,
  );

  console.log("measure-context-baseline: ok");
  console.log(
    JSON.stringify(
      {
        cwd,
        tools7,
        toolsAll,
        godotEditorToolCount: GODOT_TOOLS.length,
        systemTokens7: system7,
        systemTokensAll: systemAll,
        schemaTokens7,
        schemaTokensAll,
        totalTokensEst7: total7,
        totalTokensEstAll: totalAll,
        delta,
        codeAppendTokensEst: codeAppendTokens,
        designAppendTokensEst: designAppendTokens,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

