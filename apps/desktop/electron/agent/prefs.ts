import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ClientPrefs, DEFAULT_PREFS } from "../../shared/ipc";

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
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<ClientPrefs>;
    return { ...DEFAULT_PREFS, ...raw };
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
  return savePrefs(next);
}

export function getAgentDirPath(): string {
  return ensureAgentDir();
}
