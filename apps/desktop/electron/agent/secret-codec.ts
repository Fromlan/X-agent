/**
 * Encrypt secrets at rest with Electron safeStorage when available.
 * Falls back to plaintext outside Electron (tests / CLI scripts).
 */
import { createRequire } from "node:module";

const ENC_PREFIX = "enc:v1:";

type SafeStorageLike = {
  isEncryptionAvailable: () => boolean;
  encryptString: (plain: string) => Buffer;
  decryptString: (encrypted: Buffer) => string;
};

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

/** Encrypt for disk; returns plaintext if safeStorage unavailable. */
export function encryptSecret(plain: string): string {
  const trimmed = plain.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith(ENC_PREFIX)) return trimmed;
  const ss = tryGetSafeStorage();
  if (!ss) return trimmed;
  try {
    const buf = ss.encryptString(trimmed);
    return ENC_PREFIX + buf.toString("base64");
  } catch {
    return trimmed;
  }
}

/** Decrypt from disk; passthrough for legacy plaintext. */
export function decryptSecret(stored: string): string {
  const trimmed = (stored ?? "").trim();
  if (!trimmed) return "";
  if (!trimmed.startsWith(ENC_PREFIX)) return trimmed;
  const ss = tryGetSafeStorage();
  if (!ss) {
    // Cannot decrypt without OS keychain — return empty to avoid leaking ciphertext as key.
    return "";
  }
  try {
    const b64 = trimmed.slice(ENC_PREFIX.length);
    return ss.decryptString(Buffer.from(b64, "base64"));
  } catch {
    return "";
  }
}

export function isEncryptedSecret(stored: string): boolean {
  return (stored ?? "").trim().startsWith(ENC_PREFIX);
}
