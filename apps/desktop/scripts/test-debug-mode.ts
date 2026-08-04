/**
 * Electron 调试模式契约：锁住开发默认 DevTools、打包参数和快捷键入口。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(appRoot, "../..");
const main = readFileSync(join(appRoot, "electron/main.ts"), "utf8");
const appPackage = JSON.parse(
  readFileSync(join(appRoot, "package.json"), "utf8"),
) as { scripts?: Record<string, string> };
const rootPackage = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
) as { scripts?: Record<string, string> };

assert.match(main, /--x-agent-debug/);
assert.match(main, /--debug-ui/);
assert.match(main, /X_AGENT_DEBUG/);
assert.match(main, /openDevTools\(\{ mode: "detach" \}\)/);
assert.match(main, /before-input-event/);
assert.match(main, /input\.key === "F12"/);
assert.match(main, /input\.control && input\.shift && key === "i"/);
assert.match(main, /second-instance/);
assert.equal(
  appPackage.scripts?.debug,
  "set X_AGENT_DEBUG=1&& electron-vite dev",
);
assert.equal(
  rootPackage.scripts?.["desktop:debug"],
  "npm run debug --prefix apps/desktop",
);

console.log("test-debug-mode: ok");
