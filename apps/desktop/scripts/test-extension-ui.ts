import {
  createDesktopExtensionUi,
  mapExtensionNotifyLevel,
} from "../electron/agent/extension-ui";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(mapExtensionNotifyLevel("info") === "info", "info");
assert(mapExtensionNotifyLevel("warning") === "warn", "warning→warn");
assert(mapExtensionNotifyLevel("error") === "error", "error");

{
  const seen: Array<{ message: string; type: string }> = [];
  const ui = createDesktopExtensionUi((message, type) => {
    seen.push({ message, type });
  });
  ui.notify("Godot RPC ready", "info");
  ui.notify("  ", "warning");
  ui.notify("boom", "error");
  assert(seen.length === 2, "skips blank");
  assert(seen[0]?.message === "Godot RPC ready" && seen[0]?.type === "info", "info notify");
  assert(seen[1]?.message === "boom" && seen[1]?.type === "error", "error notify");
}

console.log("test-extension-ui: ok");
