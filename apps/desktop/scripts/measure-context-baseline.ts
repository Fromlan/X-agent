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
} from "../shared/ipc";
import { createGodotDocsTools } from "../electron/agent/godot-docs-tools";
import { createGodotTools } from "../electron/agent/godot-tools";
import type { GodotRpcBridge } from "../electron/agent/godot-rpc-bridge";

import { estimateTextTokens } from "../electron/agent/context-breakdown";

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
  const godotDocsDefs = createGodotDocsTools() as unknown as ToolDefLike[];
  const godotByName = toolDefsByName([...godotEditorDefs, ...godotDocsDefs]);

  const defsByName: Record<string, ToolDefLike> = {
    ...builtinByName,
    ...godotByName,
  };

  const tools7 = [...AVAILABLE_TOOLS];
  const tools19 = [...ALL_TOGGLEABLE_TOOLS];

  assert(
    tools7.length === 7,
    `sanity: AVAILABLE_TOOLS length should be 7, got ${tools7.length}`,
  );
  assert(
    tools19.length === 19,
    `sanity: ALL_TOGGLEABLE_TOOLS length should be 19, got ${tools19.length}`,
  );

  const system7 = estimateSystemTokens({ cwd, toolNames: tools7, defsByName });
  const system19 = estimateSystemTokens({ cwd, toolNames: tools19, defsByName });
  // Schema estimation doesn't need the system prompt; keep it separate so deltas
  // explain whether the payload bloat comes from "tool schemas" vs "system".
  const schemaTokens7 = estimateSchemaTokens(tools7, defsByName);
  const schemaTokens19 = estimateSchemaTokens(tools19, defsByName);

  const total7 = system7 + schemaTokens7;
  const total19 = system19 + schemaTokens19;
  const delta = total19 - total7;

  // "Expected" here is intentionally loose: we only want a regression guard.
  assert(
    delta >= 400,
    `baseline delta too small (expected >=400): delta=${delta}, total7=${total7}, total19=${total19}`,
  );

  console.log("measure-context-baseline: ok");
  console.log(
    JSON.stringify(
      {
        cwd,
        tools7,
        tools19,
        godotEditorToolCount: GODOT_TOOLS.length,
        systemTokens7: system7,
        systemTokens19: system19,
        schemaTokens7,
        schemaTokens19,
        totalTokensEst7: total7,
        totalTokensEst19: total19,
        delta,
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

