import type { SessionUsageSnapshot } from "@shared/ipc";

type Listener = () => void;

let sessionUsage: SessionUsageSnapshot | null = null;
let compacting = false;
let storeVersion = 0;
const listeners = new Set<Listener>();

function emit(): void {
  storeVersion += 1;
  for (const l of listeners) l();
}

export function getSessionUsageState(): SessionUsageSnapshot | null {
  return sessionUsage;
}

export function getCompacting(): boolean {
  return compacting;
}

export function getSessionUsageStoreVersion(): number {
  return storeVersion;
}

export function setSessionUsage(usage: SessionUsageSnapshot | null): void {
  sessionUsage = usage;
  emit();
}

export function setCompacting(value: boolean): void {
  if (compacting === value) return;
  compacting = value;
  emit();
}

export function clearSessionUsage(): void {
  sessionUsage = null;
  compacting = false;
  emit();
}

export function subscribeSessionUsageStore(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
