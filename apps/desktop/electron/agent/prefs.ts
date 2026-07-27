import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ClientPrefs, DEFAULT_PREFS } from "../../shared/ipc";
import { normalizeGodotDocsBranch } from "./godot-docs-cache";

function agentDir(): string {
  return join(homedir(), ".pi", "agent");
}

function prefsPath(): string {
  return join(agentDir(), "x-agent.json");
}

export function ensureAgentDir(): string {
  const dir = agentDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function loadPrefs(): ClientPrefs {
  ensureAgentDir();
  const path = prefsPath();
  if (!existsSync(path)) {
    const defaults = { ...DEFAULT_PREFS };
    writeFileSync(path, JSON.stringify(defaults, null, 2), "utf8");
    return defaults;
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<ClientPrefs> & {
      language?: unknown;
    };
    // Drop legacy unused `language` field from older prefs files.
    const { language: _legacyLanguage, ...rest } = raw;
    const hiddenProjectKeys = Array.isArray(rest.hiddenProjectKeys)
      ? rest.hiddenProjectKeys.filter(
          (k): k is string => typeof k === "string" && k.trim().length > 0,
        )
      : [];
    return {
      ...DEFAULT_PREFS,
      ...rest,
      hiddenProjectKeys,
      godotDocsBranch: normalizeGodotDocsBranch(
        typeof rest.godotDocsBranch === "string"
          ? rest.godotDocsBranch
          : DEFAULT_PREFS.godotDocsBranch,
      ),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: ClientPrefs): ClientPrefs {
  ensureAgentDir();
  writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2), "utf8");
  return prefs;
}

export function patchPrefs(patch: Partial<ClientPrefs>): ClientPrefs {
  const next = { ...loadPrefs(), ...patch };
  if (typeof patch.godotDocsBranch === "string") {
    next.godotDocsBranch = normalizeGodotDocsBranch(patch.godotDocsBranch);
  }
  return savePrefs(next);
}

export function getAgentDirPath(): string {
  return ensureAgentDir();
}
