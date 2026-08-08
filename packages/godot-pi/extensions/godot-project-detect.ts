/**
 * Pure parser for Godot `project.godot` files.
 *
 * Lives outside `godot-helpers.ts` so it can be unit-tested without spinning up
 * a Pi ExtensionAPI mock. The extension's `godot_detect_project` tool wraps this
 * helper to produce the tool result shape.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface GodotProjectInfo {
  /** Whether `root/project.godot` exists and was readable. */
  isGodot: boolean;
  /** Absolute path that was probed (echoed back so the caller can show context). */
  root: string;
  /** `application/config/name` from project.godot; `"(unnamed)"` if absent. */
  name: string;
  /** `config_version` integer from project.godot; `"?"` if absent. */
  configVersion: string;
  /** `run/main_scene` res:// path; `null` if absent (project boots no scene). */
  mainScene: string | null;
}

/**
 * Read `project.godot` from `root` and extract name / config_version / main_scene.
 * Returns `{ isGodot: false, ... }` when the file is missing or empty.
 */
export function detectGodotProject(root: string): GodotProjectInfo {
  const projectFile = join(root, "project.godot");
  if (!existsSync(projectFile)) {
    return {
      isGodot: false,
      root,
      name: "(unnamed)",
      configVersion: "?",
      mainScene: null,
    };
  }
  const text = readFileSync(projectFile, "utf8");
  if (text.trim() === "") {
    return {
      isGodot: false,
      root,
      name: "(unnamed)",
      configVersion: "?",
      mainScene: null,
    };
  }
  const nameMatch = text.match(/config\/name\s*=\s*"([^"]+)"/);
  const versionMatch = text.match(/config_version\s*=\s*(\d+)/);
  const mainMatch = text.match(/run\/main_scene\s*=\s*"([^"]+)"/);
  return {
    isGodot: true,
    root,
    name: nameMatch?.[1] ?? "(unnamed)",
    configVersion: versionMatch?.[1] ?? "?",
    mainScene: mainMatch?.[1] ?? null,
  };
}

/**
 * Render the `godot_detect_project` tool's user-facing text line.
 * Mirrors the wording used by the extension's tool body so tests can assert it.
 */
export function formatGodotProjectInfo(info: GodotProjectInfo): string {
  if (!info.isGodot) {
    return `Not a Godot project root: missing project.godot under ${info.root}`;
  }
  return `Godot project "${info.name}" (config_version=${info.configVersion}) at ${info.root}${
    info.mainScene ? `; main_scene=${info.mainScene}` : ""
  }`;
}