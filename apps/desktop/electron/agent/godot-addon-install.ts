import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type InstallGodotRpcAddonResult = {
  ok: boolean;
  projectPath?: string;
  installed?: boolean;
  enabled?: boolean;
  addonPath?: string;
  error?: string;
  hint?: string;
};

const ADDON_REL = join("packages", "godot-editor-rpc", "addons", "x_agent_rpc");

const requireElectron = createRequire(import.meta.url);

function tryElectronPaths(): { resourcesPath?: string; appPath?: string } {
  try {
    const electron = requireElectron("electron") as {
      app?: { getAppPath: () => string };
    };
    const app = electron.app;
    if (!app) return {};
    return {
      resourcesPath:
        typeof process.resourcesPath === "string"
          ? process.resourcesPath
          : undefined,
      appPath: app.getAppPath(),
    };
  } catch {
    return {};
  }
}

/** Walk parents of `start` looking for `packages/godot-editor-rpc/addons/x_agent_rpc`. */
function findAddonUnderAncestors(start: string): string | null {
  let dir = resolve(start);
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, ADDON_REL);
    if (existsSync(join(candidate, "plugin.cfg"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Resolve bundled / workspace x_agent_rpc addon directory.
 * Packaged builds must prefer electron-builder `extraResources` over any
 * monorepo tree that happens to sit under cwd/appPath.
 * Dev: electron-vite may load from `out/main` or `out/main/chunks`, so we
 * walk ancestors for `packages/godot-editor-rpc/addons/x_agent_rpc`.
 */
export function findSourceAddonDir(): string | null {
  const { resourcesPath, appPath } = tryElectronPaths();

  // 1) Packaged app resources (highest priority when present)
  if (resourcesPath) {
    const packaged = join(resourcesPath, "godot-addons", "x_agent_rpc");
    if (existsSync(join(packaged, "plugin.cfg"))) return packaged;
  }

  // 2) Dev / monorepo: walk from appPath, bundle dir, then cwd
  if (appPath) {
    const fromApp = findAddonUnderAncestors(appPath);
    if (fromApp) return fromApp;
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const fromHere = findAddonUnderAncestors(here);
  if (fromHere) return fromHere;

  const fromCwd = findAddonUnderAncestors(process.cwd());
  if (fromCwd) return fromCwd;

  for (const c of [
    resolve(process.cwd(), ADDON_REL),
    resolve(process.cwd(), "..", "..", ADDON_REL),
  ]) {
    if (existsSync(join(c, "plugin.cfg"))) return c;
  }
  return null;
}

function readProjectGodot(projectPath: string): string {
  return readFileSync(join(projectPath, "project.godot"), "utf8");
}

function writeProjectGodot(projectPath: string, content: string): void {
  writeFileSync(join(projectPath, "project.godot"), content, "utf8");
}

function parseQuotedStrings(raw: string): string[] {
  return Array.from(raw.matchAll(/"([^"]+)"/g)).map((m) => m[1]!);
}

/**
 * Append desired plugin to [editor_plugins] enabled=PackedStringArray(...).
 * Only touches that section — never scans the whole project.godot for quotes.
 */
function ensureEditorPluginsEnabled(
  content: string,
  desiredEnabled: string,
): { next: string; enabled: boolean } {
  const sectionRegex = /\[editor_plugins\]([\s\S]*?)(?=\n\[|$)/;
  const sectionMatch = content.match(sectionRegex);
  const sectionBody = sectionMatch?.[1] ?? "";
  const enabledMatch = sectionBody.match(
    /enabled\s*=\s*PackedStringArray\s*\(([^)]*)\)/,
  );

  const existing = enabledMatch
    ? parseQuotedStrings(enabledMatch[1] ?? "")
    : [];

  if (existing.includes(desiredEnabled)) {
    return { next: content, enabled: false };
  }

  const nextList = [...existing, desiredEnabled];
  const packed = `enabled=PackedStringArray(${nextList
    .map((s) => `"${s}"`)
    .join(",")})`;

  if (!sectionMatch || sectionMatch.index === undefined) {
    return {
      next: `${content.trimEnd()}\n\n[editor_plugins]\n${packed}\n`,
      enabled: true,
    };
  }

  if (enabledMatch) {
    const fullSection = sectionMatch[0];
    const newSectionBody = sectionBody.replace(
      /enabled\s*=\s*PackedStringArray\s*\([^)]*\)/,
      packed,
    );
    const newSection = `[editor_plugins]${newSectionBody}`;
    return {
      next: content.replace(fullSection, newSection),
      enabled: true,
    };
  }

  return {
    next: content.replace(
      "[editor_plugins]",
      `[editor_plugins]\n${packed}`,
    ),
    enabled: true,
  };
}

export function installGodotRpcAddon(
  projectPath: string,
): InstallGodotRpcAddonResult {
  const desiredEnabled = "res://addons/x_agent_rpc/plugin.cfg";
  if (!existsSync(projectPath)) {
    return { ok: false, projectPath, error: "项目目录不存在" };
  }

  const projectGodotPath = join(projectPath, "project.godot");
  if (!existsSync(projectGodotPath)) {
    return { ok: false, projectPath, error: "缺少 project.godot" };
  }

  const sourceAddon = findSourceAddonDir();
  if (!sourceAddon) {
    return {
      ok: false,
      projectPath,
      error: "找不到内置的 x_agent_rpc 插件资源（开发环境请确认仓库含 packages/godot-editor-rpc）。",
      hint: "可先手动把 addons/x_agent_rpc 复制到项目 addons/ 下。",
    };
  }

  const targetAddonDir = join(projectPath, "addons", "x_agent_rpc");
  const targetAddonsRoot = join(projectPath, "addons");
  if (!existsSync(targetAddonsRoot)) {
    mkdirSync(targetAddonsRoot, { recursive: true });
  }

  try {
    cpSync(sourceAddon, targetAddonDir, {
      recursive: true,
      force: true,
    });
  } catch (e) {
    return {
      ok: false,
      projectPath,
      addonPath: targetAddonDir,
      error: e instanceof Error ? e.message : `拷贝失败：${String(e)}`,
    };
  }

  const prev = readProjectGodot(projectPath);
  const { next, enabled } = ensureEditorPluginsEnabled(prev, desiredEnabled);
  if (next !== prev) {
    writeProjectGodot(projectPath, next);
  }

  return {
    ok: true,
    projectPath,
    installed: true,
    enabled,
    addonPath: targetAddonDir,
    hint: enabled
      ? "已拷贝并启用 X-agent RPC 插件。需要重启 Godot 编辑器以生效。"
      : "已拷贝 X-agent RPC 插件（enabled 未变化）。如未生效请重启编辑器。",
  };
}
