/**
 * Encrypt secrets at rest with Electron safeStorage when available.
 * Falls back to plaintext outside Electron (tests / CLI scripts).
 */
import { createRequire } from "node:module";
import type { SecretCodecReason, SecretCodecStatus } from "../../shared/ipc";

const ENC_PREFIX = "enc:v1:";

type SafeStorageLike = {
  isEncryptionAvailable: () => boolean;
  encryptString: (plain: string) => Buffer;
  decryptString: (encrypted: Buffer) => string;
};

let cachedStatus: SecretCodecStatus | null = null;

function tryGetSafeStorage(): SafeStorageLike | null {
  try {
    const require = createRequire(import.meta.url);
    const electron = require("electron") as { safeStorage?: SafeStorageLike };
    const ss = electron.safeStorage;
    if (
      ss &&
      typeof ss.isEncryptionAvailable === "function" &&
      ss.isEncryptionAvailable()
    ) {
      return ss;
    }
  } catch {
    // Not running under Electron
  }
  return null;
}

/** 解析一次并缓存 safeStorage 状态,供 getSecretCodecStatus() 复用。 */
export function probeSecretCodecStatus(): SecretCodecStatus {
  if (cachedStatus) return cachedStatus;
  let reason: SecretCodecReason | undefined;
  try {
    const require = createRequire(import.meta.url);
    const electron = require("electron") as { safeStorage?: SafeStorageLike };
    if (!electron.safeStorage) {
      reason = "no-electron";
    } else if (!electron.safeStorage.isEncryptionAvailable()) {
      reason = "keychain-unavailable";
    }
  } catch {
    reason = "no-electron";
  }
  cachedStatus = reason
    ? { available: false, reason }
    : { available: true };
  return cachedStatus;
}

/** IPC handler 入口:返回当前 safeStorage 状态供 UI 横幅。 */
export function getSecretCodecStatus(): SecretCodecStatus {
  return probeSecretCodecStatus();
}

/** Encrypt for disk; returns plaintext if safeStorage unavailable. */
export function encryptSecret(plain: string): string {
  const trimmed = plain.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith(ENC_PREFIX)) return trimmed;
  const ss = tryGetSafeStorage();
  if (!ss) {
    // 记录 fallback —— 但 cachedStatus 已固定,这里仅覆盖 reason
    if (cachedStatus?.available) {
      cachedStatus = { available: false, reason: "keychain-unavailable" };
    }
    return trimmed;
  }
  try {
    const buf = ss.encryptString(trimmed);
    return ENC_PREFIX + buf.toString("base64");
  } catch {
    if (cachedStatus?.available) {
      cachedStatus = { available: false, reason: "encrypt-failed" };
    }
    return trimmed;
  }
}

/**
 * Decrypt with failure reporting.
 * - plaintext (legacy) → `{ ok: true, value }`
 * - `enc:v1:` ciphertext + safeStorage available + decrypt succeeds → `{ ok: true, value }`
 * - ciphertext but safeStorage missing / decrypt throws → `{ ok: false, value: "" }`
 * Callers must keep the ciphertext around when `ok === false` so a later save
 * cannot overwrite the only copy of the key with an empty string.
 */
export function decryptSecretResult(stored: string): {
  ok: boolean;
  value: string;
} {
  const trimmed = (stored ?? "").trim();
  if (!trimmed) return { ok: true, value: "" };
  if (!trimmed.startsWith(ENC_PREFIX)) return { ok: true, value: trimmed };
  const ss = tryGetSafeStorage();
  if (!ss) {
    // Cannot decrypt without OS keychain — report failure so the caller can
    // preserve the ciphertext instead of leaking it as a fake key.
    return { ok: false, value: "" };
  }
  try {
    const b64 = trimmed.slice(ENC_PREFIX.length);
    return { ok: true, value: ss.decryptString(Buffer.from(b64, "base64")) };
  } catch {
    return { ok: false, value: "" };
  }
}

/** Decrypt from disk; passthrough for legacy plaintext. */
export function decryptSecret(stored: string): string {
  return decryptSecretResult(stored).value;
}

export function isEncryptedSecret(stored: string): boolean {
  return (stored ?? "").trim().startsWith(ENC_PREFIX);
}