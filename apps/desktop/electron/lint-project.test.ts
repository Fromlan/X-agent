/** Verify static rules catch actual syntax and renderer imports without flagging comments. */
import { expect, it } from "vitest";
import { lintSource } from "../scripts/lint-project";
it("catches debugger, dynamic execution and renderer Node access", () => {
  expect(lintSource("src/widget.ts", 'import fs from "node:fs"; debugger; eval("x"); new Function("x");')).toHaveLength(4);
  expect(lintSource("src/widget.ts", 'const fs = await import("node:fs");')).toHaveLength(1);
});
it("accepts main-process Node imports and ignores comments and literal examples", () => {
  expect(lintSource("electron/worker.ts", 'import fs from "node:fs"; // debugger;\nconst s = "eval(x)";')).toEqual([]);
  expect(lintSource("src/widget.ts", 'import { x } from "@shared/ipc";')).toEqual([]);
});

it.each(["node:fs", "fs", "electron", "@earendil-works/pi-coding-agent"])("rejects renderer dynamic imports of %s", (module) => {
  expect(lintSource("src/widget.ts", `const dependency = await import("${module}");`)).toHaveLength(1);
});

it("accepts main-process and shared renderer dynamic imports", () => {
  expect(lintSource("electron/worker.ts", 'const fs = await import("node:fs");')).toEqual([]);
  expect(lintSource("src/widget.ts", 'const ipc = await import("@shared/ipc");')).toEqual([]);
});
