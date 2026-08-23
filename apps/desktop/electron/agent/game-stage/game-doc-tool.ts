/**
 * write_game_doc — planning-stage custom tool.
 *
 * Lets the planning stage write design/configuration artifacts without opening
 * full write/edit access to the whole project. Paths are constrained to the
 * project's `.game/design` and `.game/config` directories by the tool itself;
 * this is a soft but practical guard while keeping the rest of the cycle safe.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

const GAME_DOC_EXTENSIONS = new Set([
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
]);

function isInsideRoot(root: string, target: string): boolean {
  const rootResolved = resolve(root);
  const targetResolved = resolve(target);
  if (targetResolved === rootResolved) return true;
  const rootLower = rootResolved.toLowerCase();
  const targetLower = targetResolved.toLowerCase();
  const prefix = rootLower.endsWith(sep) ? rootLower : rootLower + sep;
  return targetLower.startsWith(prefix);
}

function isValidGameDocTarget(cwd: string, rawPath: string): string | null {
  if (!cwd || !rawPath) return "项目路径或文档路径为空";
  if (isAbsolute(rawPath)) return "write_game_doc 只接受项目相对路径";
  const normalized = rawPath.replaceAll("\\", "/");
  if (normalized.includes("\0")) return "路径包含非法字符";
  const absolute = resolve(cwd, normalized);
  const roots = [
    join(cwd, ".game", "design"),
    join(cwd, ".game", "config"),
  ];
  if (!roots.some((root) => isInsideRoot(root, absolute))) {
    return "write_game_doc 只能写入 .game/design 或 .game/config";
  }
  const ext = normalized.slice(normalized.lastIndexOf(".")).toLowerCase();
  if (!GAME_DOC_EXTENSIONS.has(ext)) {
    return "write_game_doc 仅支持 .md / .json / .yaml / .yml / .toml";
  }
  const rel = relative(cwd, absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) return "路径超出项目目录";
  return null;
}

/**
 * Create the planning design-doc custom tool. getCwd returns the active project
 * root so the tool stays scoped to the current session's project.
 */
export function createWriteGameDocTools(
  getCwd: () => string | null,
): ToolDefinition[] {
  return [
    defineTool({
      name: "write_game_doc",
      label: "Write game design doc",
      description:
        "Write planning-stage design/config artifacts under .game/design or .game/config. " +
        "Use for GDD, idea notes, gameplay config, balance tables, or JSON/YAML/TOML configs. " +
        "Do NOT use for game code or scenes.",
      parameters: Type.Object({
        path: Type.String({
          description:
            "Project-relative path, e.g. .game/design/01-gdd.md or .game/config/gameplay.json",
        }),
        content: Type.String({
          description: "Markdown / JSON / YAML / TOML content to write",
        }),
      }),
      async execute(_toolCallId, params) {
        const rawPath =
          typeof params.path === "string" ? params.path.trim() : "";
        const content =
          typeof params.content === "string" ? params.content : "";
        const cwd = getCwd();
        if (!cwd) throw new Error("当前未打开项目");
        if (!rawPath) throw new Error("文档路径不能为空");
        if (content.length > 2_000_000) {
          throw new Error("内容过长（上限 2,000,000 字符）");
        }
        const invalid = isValidGameDocTarget(cwd, rawPath);
        if (invalid) throw new Error(invalid);
        const target = resolve(cwd, rawPath.replaceAll("\\", "/"));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content, "utf8");
        return {
          content: [
            {
              type: "text" as const,
              text: `已写入设计/配置文档 ${target}`,
            },
          ],
          details: { path: target },
        };
      },
    }),
  ];
}
