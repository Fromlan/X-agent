/**
 * Headless smoke test for SessionHost / Pi SDK wiring.
 * Usage: npx tsx scripts/smoke-session.ts [cwd]
 */
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { homedir } from "node:os";

const cwd = process.argv[2] ?? process.cwd();
const agentDir = getAgentDir();
const authPath = join(homedir(), ".pi", "agent", "auth.json");
const modelsPath = join(homedir(), ".pi", "agent", "models.json");

console.log("cwd:", cwd);
console.log("agentDir:", agentDir);

const modelRuntime = await ModelRuntime.create({ authPath, modelsPath });
const available = await modelRuntime.getAvailable();
// 不偏好任何虚构默认模型：直接取第一个可用条目（deepseek-v4-flash 已从默认值移除）。
const preferred = available[0];
console.log(
  "models:",
  available.slice(0, 5).map((m) => `${m.provider}/${m.id}`),
);

const loader = new DefaultResourceLoader({ cwd, agentDir });
await loader.reload();

const { session } = await createAgentSession({
  cwd,
  agentDir,
  resourceLoader: loader,
  modelRuntime,
  model: preferred,
  sessionManager: SessionManager.inMemory(cwd),
  tools: ["read", "ls"],
});

console.log("sessionId:", session.sessionId);
console.log("model:", session.model ? `${session.model.provider}/${session.model.id}` : null);

let text = "";
const unsub = session.subscribe((event) => {
  if (event.type === "message_update") {
    const ame = event.assistantMessageEvent as { type?: string; delta?: string };
    if (ame?.type === "text_delta" && ame.delta) {
      text += ame.delta;
      process.stdout.write(ame.delta);
    }
  }
  if (event.type === "tool_execution_start") {
    console.log(`\n[tool] ${event.toolName}`);
  }
});

try {
  await session.prompt("用一句话说明当前目录有哪些顶层文件，不要修改任何文件。");
  console.log("\n--- done ---");
  console.log("chars:", text.length);
} finally {
  unsub();
  session.dispose();
}
