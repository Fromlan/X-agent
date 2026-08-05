import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from "node:path";
import type {
  PluginCreateInput,
  PluginItem,
  PluginKind,
  PluginMutateResult,
  PluginReadResult,
  PluginScope,
  PluginWriteResult,
} from "../../shared/ipc";
import {
  getInstalledPackageRoots,
  listInstalledPackages,
  resolvePackageRoot,
} from "./package-manager";
import { getAgentDirPath } from "./prefs";

const NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function isValidPluginName(name: string): boolean {
  return name.length >= 1 && name.length <= 64 && NAME_RE.test(name);
}

function agentRoot(): string {
  return getAgentDirPath();
}

function globalDir(kind: PluginKind): string {
  const folder =
    kind === "prompt"
      ? "prompts"
      : kind === "skill"
        ? "skills"
        : kind === "extension"
          ? "extensions"
          : "themes";
  return join(agentRoot(), folder);
}

function projectDir(cwd: string, kind: PluginKind): string {
  const folder =
    kind === "prompt"
      ? "prompts"
      : kind === "skill"
        ? "skills"
        : kind === "extension"
          ? "extensions"
          : "themes";
  return join(cwd, ".pi", folder);
}

function toPosixLower(p: string): string {
  return normalize(p).replace(/\\/g, "/").toLowerCase();
}

function isUnderRoot(target: string, root: string): boolean {
  const absRoot = resolve(root);
  const absTarget = resolve(target);
  const rel = relative(absRoot, absTarget);
  if (!rel || rel === ".") return true;
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  return toPosixLower(absTarget).startsWith(`${toPosixLower(absRoot)}/`) ||
    toPosixLower(absTarget) === toPosixLower(absRoot);
}

/** Writable plugin roots (global / project). Package trees are read-only in UI. */
export function getWritablePluginRoots(cwd?: string | null): string[] {
  const roots = [
    globalDir("prompt"),
    globalDir("skill"),
    globalDir("extension"),
    globalDir("theme"),
  ];
  if (cwd) {
    roots.push(
      projectDir(cwd, "prompt"),
      projectDir(cwd, "skill"),
      projectDir(cwd, "extension"),
      projectDir(cwd, "theme"),
    );
  }
  return roots.map((r) => resolve(r));
}

export function getReadablePluginRoots(cwd?: string | null): string[] {
  return [...getWritablePluginRoots(cwd), ...getInstalledPackageRoots().map((r) => resolve(r))];
}

export function isAllowedPluginPath(
  targetPath: string,
  cwd?: string | null,
  mode: "read" | "write" = "read",
): boolean {
  if (!targetPath) return false;
  const abs = resolve(targetPath);
  const roots =
    mode === "write" ? getWritablePluginRoots(cwd) : getReadablePluginRoots(cwd);
  return roots.some((root) => isUnderRoot(abs, root));
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function skillWarnings(content: string): string[] {
  const fm = parseFrontmatter(content);
  const warnings: string[] = [];
  if (!fm.name) warnings.push("缺少 frontmatter 字段 name");
  if (!fm.description) warnings.push("缺少 frontmatter 字段 description");
  return warnings;
}

function promptScaffold(name: string): string {
  return `---
description: ${name} prompt template
argument-hint: "[args]"
---

Describe what this prompt should do. Use $1 / $@ for arguments.
`;
}

function skillScaffold(name: string): string {
  return `---
name: ${name}
description: Describe when to use the ${name} skill (1–1024 chars).
---

# ${name}

## Steps

1. Clarify the goal.
2. Inspect relevant files with read / grep.
3. Apply the smallest safe change and summarize.
`;
}

function extensionScaffold(name: string): string {
  return `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * ${name} extension
 */
export default function (pi: ExtensionAPI): void {
  pi.registerCommand("${name}", {
    description: "${name} command",
    handler: async (_args, ctx) => {
      ctx.ui.notify("${name} is ready", "info");
    },
  });
}
`;
}

function themeScaffold(name: string): string {
  return `${JSON.stringify(
    {
      name,
      description: `${name} theme`,
      type: "dark",
      colors: {
        background: "#1e1e24",
        foreground: "#e8e8ed",
        primary: "#7aa2f7",
        secondary: "#9ece6a",
        accent: "#bb9af7",
        muted: "#6c7086",
        border: "#2a2a35",
        error: "#f7768e",
        warning: "#e0af68",
        success: "#9ece6a",
      },
    },
    null,
    2,
  )}\n`;
}

function themeWarnings(content: string): string[] {
  const warnings: string[] = [];
  try {
    const data = JSON.parse(content) as { name?: unknown };
    if (!data || typeof data !== "object") {
      warnings.push("主题须为 JSON 对象");
    } else if (typeof data.name !== "string" || !data.name.trim()) {
      warnings.push("缺少 name 字段");
    }
  } catch {
    warnings.push("JSON 无法解析");
  }
  return warnings;
}

function listPrompts(dir: string, scope: PluginScope): PluginItem[] {
  if (!existsSync(dir)) return [];
  const items: PluginItem[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".md")) continue;
    const path = join(dir, entry);
    if (!statSync(path).isFile()) continue;
    const content = readFileSync(path, "utf8");
    const fm = parseFrontmatter(content);
    const id = basename(entry, ".md");
    items.push({
      kind: "prompt",
      scope,
      id,
      name: id,
      path,
      description: fm.description,
      editable: true,
    });
  }
  return items;
}

function listSkills(dir: string, scope: PluginScope): PluginItem[] {
  if (!existsSync(dir)) return [];
  const items: PluginItem[] = [];
  for (const entry of readdirSync(dir)) {
    const skillDir = join(dir, entry);
    if (!statSync(skillDir).isDirectory()) continue;
    const skillFile = join(skillDir, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    const content = readFileSync(skillFile, "utf8");
    const fm = parseFrontmatter(content);
    items.push({
      kind: "skill",
      scope,
      id: fm.name || entry,
      name: fm.name || entry,
      path: skillDir,
      description: fm.description,
      editable: true,
    });
  }
  return items;
}

function listExtensions(dir: string, scope: PluginScope): PluginItem[] {
  if (!existsSync(dir)) return [];
  const items: PluginItem[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isFile() && entry.endsWith(".ts")) {
      items.push({
        kind: "extension",
        scope,
        id: basename(entry, ".ts"),
        name: basename(entry, ".ts"),
        path: full,
        editable: true,
      });
      continue;
    }
    if (st.isDirectory()) {
      const index = join(full, "index.ts");
      if (existsSync(index)) {
        items.push({
          kind: "extension",
          scope,
          id: entry,
          name: entry,
          path: index,
          editable: true,
        });
      }
    }
  }
  return items;
}

function listThemes(dir: string, scope: PluginScope): PluginItem[] {
  if (!existsSync(dir)) return [];
  const items: PluginItem[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const path = join(dir, entry);
    if (!statSync(path).isFile()) continue;
    let description: string | undefined;
    let displayName = basename(entry, ".json");
    try {
      const data = JSON.parse(readFileSync(path, "utf8")) as {
        name?: string;
        description?: string;
      };
      if (typeof data.name === "string" && data.name.trim()) {
        displayName = data.name.trim();
      }
      if (typeof data.description === "string") description = data.description;
    } catch {
      // keep defaults
    }
    items.push({
      kind: "theme",
      scope,
      id: basename(entry, ".json"),
      name: displayName,
      path,
      description,
      editable: true,
    });
  }
  return items;
}

function detectKind(absPath: string): PluginKind | null {
  const posix = toPosixLower(absPath);
  if (posix.includes("/prompts/") && posix.endsWith(".md")) return "prompt";
  if (existsSync(join(absPath, "SKILL.md"))) return "skill";
  if (posix.includes("/skills/") && basename(absPath) === "SKILL.md") return "skill";
  if (posix.includes("/extensions/") && (posix.endsWith(".ts") || posix.endsWith("/index.ts"))) {
    return "extension";
  }
  if (posix.includes("/themes/") && posix.endsWith(".json")) return "theme";
  return null;
}

function contentPathFor(absPath: string, kind: PluginKind): string {
  if (kind === "skill") {
    if (basename(absPath) === "SKILL.md") return absPath;
    return join(absPath, "SKILL.md");
  }
  return absPath;
}

function listPluginsFromPackages(): PluginItem[] {
  const items: PluginItem[] = [];
  for (const pkg of listInstalledPackages()) {
    const root = resolvePackageRoot(pkg);
    if (!root) continue;
    type PkgManifest = {
      pi?: { skills?: string[]; prompts?: string[]; extensions?: string[] };
    };
    let manifest: PkgManifest | null = null;
    try {
      manifest = JSON.parse(
        readFileSync(join(root, "package.json"), "utf8"),
      ) as PkgManifest;
    } catch {
      manifest = null;
    }
    const skillsRel = manifest?.pi?.skills?.[0] ?? "./skills";
    const promptsRel = manifest?.pi?.prompts?.[0] ?? "./prompts";
    const extensionsRel = manifest?.pi?.extensions?.[0] ?? "./extensions";
    const tag = pkg.name;

    for (const item of listSkills(resolve(root, skillsRel), "global")) {
      items.push({
        ...item,
        id: `pkg:${tag}:${item.id}`,
        description: [item.description, `Package · ${tag}`]
          .filter(Boolean)
          .join(" · "),
        editable: false,
        packageName: tag,
      });
    }
    for (const item of listPrompts(resolve(root, promptsRel), "global")) {
      items.push({
        ...item,
        id: `pkg:${tag}:${item.id}`,
        description: [item.description, `Package · ${tag}`]
          .filter(Boolean)
          .join(" · "),
        editable: false,
        packageName: tag,
      });
    }
    for (const item of listExtensions(resolve(root, extensionsRel), "global")) {
      items.push({
        ...item,
        id: `pkg:${tag}:${item.id}`,
        description: [item.description, `Package · ${tag}`]
          .filter(Boolean)
          .join(" · "),
        editable: false,
        packageName: tag,
      });
    }
  }
  return items;
}

export function listPlugins(cwd?: string | null): PluginItem[] {
  const items: PluginItem[] = [
    ...listPrompts(globalDir("prompt"), "global"),
    ...listSkills(globalDir("skill"), "global"),
    ...listExtensions(globalDir("extension"), "global"),
    ...listThemes(globalDir("theme"), "global"),
  ];
  if (cwd) {
    items.push(
      ...listPrompts(projectDir(cwd, "prompt"), "project"),
      ...listSkills(projectDir(cwd, "skill"), "project"),
      ...listExtensions(projectDir(cwd, "extension"), "project"),
      ...listThemes(projectDir(cwd, "theme"), "project"),
    );
  }
  items.push(...listPluginsFromPackages());
  return items.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    if (a.scope !== b.scope) return a.scope.localeCompare(b.scope);
    return a.name.localeCompare(b.name);
  });
}

export function readPlugin(
  targetPath: string,
  cwd?: string | null,
): PluginReadResult {
  try {
    const abs = resolve(targetPath);
    const kind = detectKind(abs);
    if (!kind) return { ok: false, error: "无法识别插件类型" };
    const file = contentPathFor(abs, kind);
    const guard = kind === "skill" ? dirname(file) : file;
    if (!isAllowedPluginPath(guard, cwd, "read")) {
      return { ok: false, error: "路径不在允许的插件目录内" };
    }
    if (!existsSync(file)) return { ok: false, error: "文件不存在" };
    const content = readFileSync(file, "utf8");
    return {
      ok: true,
      content,
      warnings:
        kind === "skill"
          ? skillWarnings(content)
          : kind === "theme"
            ? themeWarnings(content)
            : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function writePlugin(
  targetPath: string,
  content: string,
  cwd?: string | null,
): PluginWriteResult {
  try {
    const abs = resolve(targetPath);
    const kind = detectKind(abs);
    if (!kind) return { ok: false, error: "无法识别插件类型" };
    const file = contentPathFor(abs, kind);
    const guard = kind === "skill" ? dirname(file) : file;
    if (!isAllowedPluginPath(guard, cwd, "write")) {
      return {
        ok: false,
        error: "该文件来自已安装 Package，请在 Packages 中管理或直接编辑包源码",
      };
    }
    ensureDir(dirname(file));
    writeFileSync(file, content, "utf8");
    return {
      ok: true,
      warnings:
        kind === "skill"
          ? skillWarnings(content)
          : kind === "theme"
            ? themeWarnings(content)
            : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function createPlugin(input: PluginCreateInput): PluginMutateResult {
  const name = input.name.trim();
  if (!isValidPluginName(name)) {
    return {
      ok: false,
      error: "名称须为 1–64 位小写字母/数字/连字符，且不能首尾为连字符",
    };
  }
  if (input.scope === "project" && !input.cwd) {
    return { ok: false, error: "项目作用域需要已打开项目" };
  }

  const base =
    input.scope === "global"
      ? globalDir(input.kind)
      : projectDir(input.cwd!, input.kind);
  ensureDir(base);

  try {
    if (input.kind === "prompt") {
      const path = join(base, `${name}.md`);
      if (existsSync(path)) return { ok: false, error: "同名提示词已存在" };
      writeFileSync(path, promptScaffold(name), "utf8");
      return {
        ok: true,
        item: {
          kind: "prompt",
          scope: input.scope,
          id: name,
          name,
          path,
          description: `${name} prompt template`,
          editable: true,
        },
      };
    }

    if (input.kind === "skill") {
      const skillDir = join(base, name);
      if (existsSync(skillDir)) return { ok: false, error: "同名技能已存在" };
      ensureDir(skillDir);
      writeFileSync(join(skillDir, "SKILL.md"), skillScaffold(name), "utf8");
      return {
        ok: true,
        item: {
          kind: "skill",
          scope: input.scope,
          id: name,
          name,
          path: skillDir,
          description: `Describe when to use the ${name} skill (1–1024 chars).`,
          editable: true,
        },
      };
    }

    if (input.kind === "theme") {
      const path = join(base, `${name}.json`);
      if (existsSync(path)) return { ok: false, error: "同名主题已存在" };
      writeFileSync(path, themeScaffold(name), "utf8");
      return {
        ok: true,
        item: {
          kind: "theme",
          scope: input.scope,
          id: name,
          name,
          path,
          description: `${name} theme`,
          editable: true,
        },
      };
    }

    const path = join(base, `${name}.ts`);
    if (existsSync(path)) return { ok: false, error: "同名扩展已存在" };
    writeFileSync(path, extensionScaffold(name), "utf8");
    return {
      ok: true,
      item: {
        kind: "extension",
        scope: input.scope,
        id: name,
        name,
        path,
        editable: true,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function deletePlugin(
  targetPath: string,
  cwd?: string | null,
): { ok: boolean; error?: string } {
  try {
    const abs = resolve(targetPath);
    const kind = detectKind(abs);
    if (!kind) return { ok: false, error: "无法识别插件类型" };

    if (kind === "skill") {
      const dir = basename(abs) === "SKILL.md" ? dirname(abs) : abs;
      if (!isAllowedPluginPath(dir, cwd, "write")) {
        return {
          ok: false,
          error: "该技能来自已安装 Package，不能从此处删除",
        };
      }
      rmSync(dir, { recursive: true, force: true });
      return { ok: true };
    }

    if (!isAllowedPluginPath(abs, cwd, "write")) {
      return {
        ok: false,
        error: "该插件来自已安装 Package，不能从此处删除",
      };
    }
    rmSync(abs, { force: true });
    // If extension was */index.ts, leave empty dir (user can clean); don't wipe parent package.
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function revealPlugin(
  targetPath: string,
  cwd?: string | null,
): { ok: boolean; path?: string; error?: string } {
  const abs = resolve(targetPath);
  const kind = detectKind(abs);
  const guard =
    kind === "skill"
      ? basename(abs) === "SKILL.md"
        ? dirname(abs)
        : abs
      : abs;
  if (
    !isAllowedPluginPath(guard, cwd, "read") &&
    !isAllowedPluginPath(abs, cwd, "read")
  ) {
    return { ok: false, error: "路径不在允许的插件目录内" };
  }
  const reveal = existsSync(abs) ? abs : guard;
  return { ok: true, path: reveal };
}
