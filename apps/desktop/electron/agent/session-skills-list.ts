/**
 * Session skills / slash-items list (issue #59 主题 A 提取).
 *
 * Lifted out of SessionHost so the host facade stays focused on
 * "接 Pi 事件 + 路由到子编排器". These are pure read operations
 * over the active cwd; they can live here as free functions and
 * be unit-tested without standing up the full SessionHost.
 */
import { join } from "node:path";
import { getCachedPrefs } from "./prefs";
import { listPlugins } from "./plugin-host";
import { applyXAgentSkillsFilter } from "./filter-session-skills";
import { buildSessionSlashItems } from "./session-slash-items";
import type {
  SessionSkillInfo,
  SessionSlashItem,
} from "../../shared/ipc";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

/**
 * Skills available for the active session cwd after X-agent filters
 * (home ~/.agents excluded + godot-* only when project.godot exists +
 * prefs.disabledSkills).
 */
export function listSessionSkills(cwd: string | null): SessionSkillInfo[] {
  if (!cwd) return [];
  const skillItems = listPlugins(cwd).filter((p) => p.kind === "skill");
  const filtered = applyXAgentSkillsFilter(
    skillItems.map((p) => ({
      name: p.name,
      description: p.description ?? "",
      filePath: join(p.path, "SKILL.md"),
    })),
    cwd,
    getCachedPrefs().disabledSkills,
  );
  const byName = new Map<string, SessionSkillInfo>();
  for (const s of filtered) {
    if (!s.name || byName.has(s.name)) continue;
    byName.set(s.name, {
      name: s.name,
      description: s.description ?? "",
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Composer `/` menu: extension commands + prompt templates + filtered skills.
 * Prefer Pi runtime lists; fall back to plugin-host prompt scan when needed.
 */
export function listSessionSlashItems(args: {
  cwd: string | null;
  session: AgentSession | null;
  resourceLoader: DefaultResourceLoader | null;
}): SessionSlashItem[] {
  const { cwd, session, resourceLoader } = args;
  if (!cwd) return [];

  const skills = listSessionSkills(cwd);

  type PromptSeed = {
    name: string;
    description: string;
    argumentHint?: string;
  };
  let prompts: PromptSeed[] = (
    resourceLoader?.getPrompts().prompts ?? []
  ).map((p) => ({
    name: p.name,
    description: p.description ?? "",
    argumentHint: p.argumentHint,
  }));
  if (prompts.length === 0 && session) {
    prompts = session.promptTemplates.map((p) => ({
      name: p.name,
      description: p.description ?? "",
      argumentHint: p.argumentHint,
    }));
  }
  if (prompts.length === 0) {
    prompts = listPlugins(cwd)
      .filter((p) => p.kind === "prompt")
      .map((p) => ({
        name: p.name,
        description: p.description ?? "",
      }));
  }

  const commands = (
    session?.extensionRunner.getRegisteredCommands() ?? []
  ).map((c) => ({
    name: (c.invocationName || c.name).trim(),
    description: c.description ?? "",
  }));

  return buildSessionSlashItems({ skills, prompts, commands });
}
