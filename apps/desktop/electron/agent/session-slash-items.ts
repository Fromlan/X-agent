import type { SessionSlashItem, SessionSlashSource } from "../../shared/ipc";

export type SlashItemSeed = {
  name: string;
  description?: string;
  argumentHint?: string;
};

export type BuildSessionSlashItemsInput = {
  skills: SlashItemSeed[];
  prompts: SlashItemSeed[];
  commands: SlashItemSeed[];
};

const SOURCE_RANK: Record<SessionSlashSource, number> = {
  command: 0,
  prompt: 1,
  skill: 2,
};

/**
 * Merge skills / prompt templates / extension commands for composer autocomplete.
 * Same name: command > prompt > skill. Sorted by source group then name.
 */
export function buildSessionSlashItems(
  input: BuildSessionSlashItemsInput,
): SessionSlashItem[] {
  const candidates: SessionSlashItem[] = [];

  for (const c of input.commands) {
    const name = c.name.trim();
    if (!name) continue;
    candidates.push({
      name,
      description: (c.description ?? "").trim(),
      source: "command",
    });
  }
  for (const p of input.prompts) {
    const name = p.name.trim();
    if (!name) continue;
    const hint = p.argumentHint?.trim();
    candidates.push({
      name,
      description: (p.description ?? "").trim(),
      source: "prompt",
      ...(hint ? { argumentHint: hint } : {}),
    });
  }
  for (const s of input.skills) {
    const name = s.name.trim();
    if (!name) continue;
    candidates.push({
      name,
      description: (s.description ?? "").trim(),
      source: "skill",
    });
  }

  const byName = new Map<string, SessionSlashItem>();
  for (const item of candidates) {
    const key = item.name.toLowerCase();
    const prev = byName.get(key);
    if (!prev || SOURCE_RANK[item.source] < SOURCE_RANK[prev.source]) {
      byName.set(key, item);
    }
  }

  return [...byName.values()].sort((a, b) => {
    const rank = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
    if (rank !== 0) return rank;
    return a.name.localeCompare(b.name);
  });
}
