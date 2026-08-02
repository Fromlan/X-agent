import type { PluginKind, PluginScope } from "@shared/ipc";

export type ScopeFilter = "all" | PluginScope;
export type PageKind = PluginKind | "package";

export const KIND_TABS: { kind: PageKind; label: string }[] = [
  { kind: "prompt", label: "提示词" },
  { kind: "skill", label: "技能" },
  { kind: "extension", label: "扩展" },
  { kind: "theme", label: "主题" },
  { kind: "package", label: "Packages" },
];

export function kindLabel(kind: PluginKind): string {
  if (kind === "prompt") return "提示词";
  if (kind === "skill") return "技能";
  if (kind === "extension") return "扩展";
  return "主题";
}