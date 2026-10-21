import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomicSync } from "./lib/atomic-write";
import { isPhysicallyInside } from "./lib/path-boundary";
import type { GodotConnectionStatus } from "../../shared/godot-connection";

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
  if (!process.versions.electron) return {};
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
  writeFileAtomicSync(join(projectPath, "project.godot"), content);
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

/** Inspect actual bundled files and the enabled list, rather than trusting a directory name. */
export function inspectGodotRpcAddon(projectPath: string): NonNullable<GodotConnectionStatus["addon"]> {
  const target = join(projectPath, "addons", "x_agent_rpc");
  const source = findSourceAddonDir();
  const installed = ["plugin.cfg", "plugin.gd", "rpc_debugger.gd"].every((name) => existsSync(join(target, name)));
  const config = installed ? readFileSync(join(target, "plugin.cfg"), "utf8") : "";
  const version = config.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const project = readProjectGodot(projectPath);
  const section = project.match(/\[editor_plugins\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? "";
  const enabled = parseQuotedStrings(section.match(/enabled\s*=\s*PackedStringArray\s*\(([^)]*)\)/)?.[1] ?? "")
    .includes("res://addons/x_agent_rpc/plugin.cfg");
  const current = Boolean(installed && source && readdirSync(source).filter((name) => /\.(gd|cfg)$/.test(name)).every((name) =>
    existsSync(join(target, name)) && readFileSync(join(source, name)).equals(readFileSync(join(target, name)))));
  return { installed, enabled, current, ...(version ? { version } : {}) };
}

/** Install only changed files and atomically enable the addon without rewriting unrelated settings. */
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
  const previous = new Map<string, Buffer | null>();
  try {
    const files = readdirSync(sourceAddon);
    for (const target of [join(projectPath, "project.godot"), targetAddonsRoot, targetAddonDir, ...files.map((name) => join(targetAddonDir, name))]) {
      if (!isPhysicallyInside(projectPath, target)) throw new Error("插件安装路径通过链接指向项目外部，已拒绝写入");
    }
    const prev = readProjectGodot(projectPath);
    const { next, enabled } = ensureEditorPluginsEnabled(prev, desiredEnabled);
    mkdirSync(targetAddonDir, { recursive: true });
    for (const name of files) {
      const bytes = readFileSync(join(sourceAddon, name));
      const target = join(targetAddonDir, name);
      const before = existsSync(target) ? readFileSync(target) : null;
      if (!before?.equals(bytes)) {
        previous.set(target, before);
        writeFileAtomicSync(target, bytes);
      }
    }
    if (next !== prev) {
      previous.set(projectGodotPath, Buffer.from(prev));
      writeProjectGodot(projectPath, next);
    }
    return {
      ok: true, projectPath, installed: true, enabled, addonPath: targetAddonDir,
      hint: "插件已准备；已打开的编辑器如未加载插件，需要启用插件或重新打开项目。",
    };
  } catch (e) {
    let restoreFailed = false;
    for (const [target, bytes] of [...previous].reverse()) {
      try {
        if (!isPhysicallyInside(projectPath, target)) throw new Error("安装路径已变化");
        if (bytes) writeFileAtomicSync(target, bytes);
        else if (existsSync(target)) unlinkSync(target);
      } catch { restoreFailed = true; }
    }
    return {
      ok: false,
      projectPath,
      addonPath: targetAddonDir,
      error: `${e instanceof Error ? e.message : `拷贝失败：${String(e)}`}${restoreFailed ? "；部分插件文件未能回滚，请检查文件权限后重新安装" : ""}`,
    };
  }

}
