/** Verify deterministic engine selection, project-version ambiguity and Windows process path parsing. */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PREFS } from "../../shared/ipc";
import { normalizeProjectKey } from "../../shared/project-path";
import { discoverGodotEngine, godotProjectFromCommandLine, type GodotEngine } from "./godot-engine-discovery";

const roots: string[] = [];

/** Declare only the project features relevant to engine compatibility. */
function project(features = '"4.6"'): string {
  const path = mkdtempSync(join(tmpdir(), "xagent-engine-test-"));
  roots.push(path);
  writeFileSync(join(path, "project.godot"), `[application]\nconfig/features=PackedStringArray(${features})\n`);
  return path;
}

/** Resolve known fake binaries without running anything installed on the developer's computer. */
function probe(versions: Record<string, string>) {
  return async (path: string): Promise<GodotEngine | undefined> => versions[path] ? { path, version: versions[path]! } : undefined;
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("Godot engine discovery", () => {
  it("uses the project's explicit engine before a global default", async () => {
    const path = project();
    const result = await discoverGodotEngine(path, { ...DEFAULT_PREFS, godotEditorPath: "global", godotProjectEditors: { [normalizeProjectKey(path)]: "project" } }, [], {
      candidates: [], probe: probe({ project: "4.6.2.stable", global: "4.5.2.stable" }),
    });
    expect(result.engine?.path).toBe("project");
  });
  it("selects the engine already running this project", async () => {
    const path = project();
    const result = await discoverGodotEngine(path, DEFAULT_PREFS, [{ pid: 1, executablePath: "running", projectPath: path }], {
      candidates: [], probe: probe({ running: "4.6.2.stable" }),
    });
    expect(result.engine?.path).toBe("running");
  });
  it("selects a unique project-compatible version and skips stale explicit paths", async () => {
    const path = project();
    const result = await discoverGodotEngine(path, { ...DEFAULT_PREFS, godotEditorPath: "missing" }, [], {
      candidates: ["older", "match"], probe: probe({ older: "4.5.2.stable", match: "4.6.2.stable" }),
    });
    expect(result.engine?.path).toBe("match");
  });
  it("does not let an older global default bypass the project's declared version", async () => {
    const path = project('"4.7"');
    const result = await discoverGodotEngine(path, { ...DEFAULT_PREFS, godotEditorPath: "global" }, [], {
      candidates: ["match"], probe: probe({ global: "4.6.2.stable", match: "4.7.0.stable" }),
    });
    expect(result.engine?.path).toBe("match");
  });
  it("keeps a mismatched global default available for manual selection without opening it", async () => {
    const path = project('"4.7"');
    const result = await discoverGodotEngine(path, { ...DEFAULT_PREFS, godotEditorPath: "global" }, [], {
      candidates: [], probe: probe({ global: "4.6.2.stable" }),
    });
    expect(result.engine).toBeUndefined();
    expect(result.candidates).toEqual([{ path: "global", version: "4.6.2.stable" }]);
  });
  it("prefers a compatible global default and respects explicit project overrides", async () => {
    const path = project();
    const prefs = { ...DEFAULT_PREFS, godotEditorPath: "global" };
    const options = { candidates: ["other"], probe: probe({ global: "4.6.2.stable", other: "4.6.1.stable", project: "4.5.2.stable" }) };
    expect((await discoverGodotEngine(path, prefs, [], options)).engine?.path).toBe("global");
    expect((await discoverGodotEngine(path, { ...prefs, godotProjectEditors: { [normalizeProjectKey(path)]: "project" } }, [], options)).engine?.path).toBe("project");
  });
  it("requires .NET for C# projects", async () => {
    const path = project('"4.6", "C#"');
    const result = await discoverGodotEngine(path, DEFAULT_PREFS, [], {
      candidates: ["standard", "dotnet"], probe: probe({ standard: "4.6.2.stable", dotnet: "4.6.2.stable.mono" }),
    });
    expect(result.engine?.path).toBe("dotnet");
  });
  it("does not choose arbitrarily between two compatible installations", async () => {
    const path = project();
    const result = await discoverGodotEngine(path, DEFAULT_PREFS, [], {
      candidates: ["first", "second"], probe: probe({ first: "4.6.1.stable", second: "4.6.2.stable" }),
    });
    expect(result.engine).toBeUndefined();
    expect(result.candidates).toHaveLength(2);
  });
  it("does not silently open a project with a mismatched discovered minor version", async () => {
    const path = project();
    const result = await discoverGodotEngine(path, DEFAULT_PREFS, [], { candidates: ["old"], probe: probe({ old: "4.5.2.stable" }) });
    expect(result.engine).toBeUndefined();
  });
  it("extracts quoted project paths but ignores game and relative process paths", () => {
    expect(godotProjectFromCommandLine('"C:\\Godot.exe" --editor --path "D:\\Games\\My Game"')).toBe("D:\\Games\\My Game");
    expect(godotProjectFromCommandLine('"C:\\Godot.exe" "D:\\Games\\My Game\\project.godot"')).toBe("D:\\Games\\My Game");
    expect(godotProjectFromCommandLine('"C:\\Godot.exe" --path "D:\\game"')).toBeUndefined();
    expect(godotProjectFromCommandLine('"C:\\Godot.exe" --editor --path relative')).toBeUndefined();
  });
});
