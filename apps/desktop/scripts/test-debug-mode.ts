/**
 * Electron 调试模式契约：锁住开发默认 DevTools、打包参数和快捷键入口。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(appRoot, "../..");
// 主题 E (#62) 把 main.ts 拆 4 module, debug 模式 invariant 分布在
// main.ts (second-instance) 和 main-debug.ts (其它 7 条). 测试要同时读.
const main = readFileSync(join(appRoot, "electron/main.ts"), "utf8");
const mainDebug = readFileSync(
  join(appRoot, "electron/main-debug.ts"),
  "utf8",
);
const combinedDebug = `${main}\n${mainDebug}`;
const appPackage = JSON.parse(
  readFileSync(join(appRoot, "package.json"), "utf8"),
) as { scripts?: Record<string, string> };
const rootPackage = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
) as { scripts?: Record<string, string> };

assert.match(combinedDebug, /--x-agent-debug/);
assert.match(combinedDebug, /--debug-ui/);
assert.match(combinedDebug, /X_AGENT_DEBUG/);
assert.match(combinedDebug, /openDevTools\(\{ mode: "detach" \}\)/);
assert.match(combinedDebug, /before-input-event/);
assert.match(combinedDebug, /input\.key === "F12"/);
assert.match(combinedDebug, /input\.control && input\.shift && key === "i"/);
assert.match(combinedDebug, /second-instance/);
assert.equal(
  appPackage.scripts?.debug,
  "set X_AGENT_DEBUG=1&& electron-vite dev",
);
assert.equal(
  rootPackage.scripts?.["desktop:debug"],
  "npm run debug --prefix apps/desktop",
);

console.log("test-debug-mode: ok");
