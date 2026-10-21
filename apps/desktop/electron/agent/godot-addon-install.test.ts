/** Verify idempotent addon preparation and preservation of existing project/plugin settings. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectGodotRpcAddon, installGodotRpcAddon } from "./godot-addon-install";
import * as atomicWrite from "./lib/atomic-write";

const roots: string[] = [];

/** Allocate a disposable Godot project with an unrelated plugin already enabled. */
function project(): string {
  const root = mkdtempSync(join(tmpdir(), "xagent-addon-test-"));
  roots.push(root);
  writeFileSync(join(root, "project.godot"), 'config_version=5\n[application]\nconfig/name="Keep me"\n[editor_plugins]\nenabled=PackedStringArray("res://addons/other/plugin.cfg")\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
  return root;
}

afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("Godot addon preparation", () => {
  it("installs and enables without changing unrelated plugins, and a second prepare changes no bytes or timestamps", () => {
    const root = project();
    expect(installGodotRpcAddon(root).ok).toBe(true);
    const projectPath = join(root, "project.godot");
    const addonPath = join(root, "addons", "x_agent_rpc", "plugin.gd");
    const before = readFileSync(projectPath);
    const projectTime = statSync(projectPath).mtimeMs;
    const addonTime = statSync(addonPath).mtimeMs;
    expect(installGodotRpcAddon(root).ok).toBe(true);
    expect(readFileSync(projectPath)).toEqual(before);
    expect(statSync(projectPath).mtimeMs).toBe(projectTime);
    expect(statSync(addonPath).mtimeMs).toBe(addonTime);
    expect(before.toString()).toContain('"res://addons/other/plugin.cfg"');
    expect(before.toString()).toContain('config/name="Keep me"');
    expect(inspectGodotRpcAddon(root)).toMatchObject({ installed: true, enabled: true, current: true, version: "0.6.4" });
  });

  it("does not mistake a directory or version-only config for a complete addon", () => {
    const root = project();
    const addon = join(root, "addons", "x_agent_rpc");
    mkdirSync(addon, { recursive: true });
    writeFileSync(join(addon, "plugin.cfg"), '[plugin]\nversion="0.6.4"\n');
    expect(inspectGodotRpcAddon(root)).toMatchObject({ installed: false, enabled: false, current: false });
    expect(installGodotRpcAddon(root).ok).toBe(true);
    writeFileSync(join(addon, "plugin.gd"), "outdated content");
    expect(inspectGodotRpcAddon(root)).toMatchObject({ installed: true, current: false });
  });

  it("rejects an addons junction escaping the project before writing any external file", () => {
    const root = project();
    const outside = mkdtempSync(join(tmpdir(), "xagent-addon-outside-"));
    roots.push(outside);
    symlinkSync(outside, join(root, "addons"), "junction");
    const before = readFileSync(join(root, "project.godot"));
    expect(installGodotRpcAddon(root)).toMatchObject({ ok: false, error: expect.stringContaining("项目外部") });
    expect(readFileSync(join(root, "project.godot"))).toEqual(before);
  });

  it("restores the previous addon when enabling the project fails after files were updated", () => {
    const root = project();
    expect(installGodotRpcAddon(root).ok).toBe(true);
    const addon = join(root, "addons", "x_agent_rpc", "plugin.gd");
    writeFileSync(addon, "keep previous addon");
    const projectPath = join(root, "project.godot");
    const before = readFileSync(projectPath, "utf8").replace(',"res://addons/x_agent_rpc/plugin.cfg"', "");
    writeFileSync(projectPath, before);
    const original = atomicWrite.writeFileAtomicSync;
    let failed = false;
    vi.spyOn(atomicWrite, "writeFileAtomicSync").mockImplementation((path, payload) => {
      if (path === projectPath && !failed) { failed = true; throw new Error("simulated disk failure"); }
      original(path, payload);
    });
    expect(installGodotRpcAddon(root)).toMatchObject({ ok: false, error: "simulated disk failure" });
    expect(readFileSync(addon, "utf8")).toBe("keep previous addon");
    expect(readFileSync(projectPath, "utf8")).toBe(before);
  });
});
