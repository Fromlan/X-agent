/**
 * Vitest 单元测试 —— secret-codec 在非 Electron 环境的 fallback 行为。
 */
import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  decryptSecretResult,
  encryptSecret,
  isEncryptedSecret,
  probeSecretCodecStatus,
} from "./secret-codec";

describe("secret-codec (non-Electron fallback)", () => {
  it("decrypt 旧 plaintext 透传", () => {
    expect(decryptSecret("plain-apikey")).toBe("plain-apikey");
    expect(decryptSecretResult("plain-apikey")).toEqual({
      ok: true,
      value: "plain-apikey",
    });
  });

  it("decrypt 空字符串返回空", () => {
    expect(decryptSecret("")).toBe("");
    expect(decryptSecretResult("")).toEqual({ ok: true, value: "" });
  });

  it("decrypt 损坏 ciphertext 在非 Electron 返回 ok:false", () => {
    const r = decryptSecretResult("enc:v1:totally-not-a-buffer");
    expect(r.ok).toBe(false);
    expect(r.value).toBe("");
  });

  it("encrypt 在非 Electron 直接返回 plaintext", () => {
    expect(encryptSecret("hello")).toBe("hello");
  });

  it("encrypt 空字符串返回空", () => {
    expect(encryptSecret("   ")).toBe("");
    expect(encryptSecret("")).toBe("");
  });

  it("isEncryptedSecret 仅识别 enc:v1: 前缀", () => {
    expect(isEncryptedSecret("plain")).toBe(false);
    expect(isEncryptedSecret("enc:v1:abc")).toBe(true);
    expect(isEncryptedSecret("  enc:v1:abc  ")).toBe(true);
  });

  it("probeSecretCodecStatus 在非 Electron 报告 keychain-unavailable / no-electron", () => {
    const status = probeSecretCodecStatus();
    expect(status.available).toBe(false);
    expect(["no-electron", "keychain-unavailable"]).toContain(status.reason);
  });

  it("encrypt 命中 ENC_PREFIX 透传（避免二次加密）", () => {
    // 用 mock safeStorage 缺失的情况下,任何 ENC_PREFIX 字符串都会原样返回,
    // 而不是再次尝试加密。但因前缀在非 Electron 环境下,encryptSecret
    // 不会主动添加前缀;用户输入 enc:v1:... 视为 plaintext 透传(合理)。
    expect(encryptSecret("enc:v1:raw")).toBe("enc:v1:raw");
  });
});
