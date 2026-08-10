/**
 * Vitest 单元测试 —— external-url 的 SSRF 防御。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  setSkipDnsForTests,
  validateExternalHttpUrl,
  validateOutboundHttpUrl,
} from "./external-url";

describe("validateExternalHttpUrl", () => {
  it("接受 https 公网", () => {
    expect(validateExternalHttpUrl("https://example.com/")).toMatchObject({
      ok: true,
    });
  });

  it("接受 http", () => {
    expect(validateExternalHttpUrl("http://example.com/path")).toMatchObject({
      ok: true,
    });
  });

  it("拒绝 file / data / javascript", () => {
    for (const bad of [
      "file:///etc/passwd",
      "data:text/plain,hello",
      "javascript:alert(1)",
      "ftp://example.com",
    ]) {
      const r = validateExternalHttpUrl(bad);
      expect(r.ok, `expected reject for ${bad}`).toBe(false);
    }
  });

  it("拒绝 localhost / loopback / 私网", () => {
    for (const bad of [
      "http://localhost/",
      "http://127.0.0.1/",
      "http://10.0.0.1/",
      "http://192.168.1.1/",
      "http://172.16.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
    ]) {
      const r = validateExternalHttpUrl(bad);
      expect(r.ok, `expected reject for ${bad}`).toBe(false);
    }
  });

  it("拒绝 DNS 重绑定域", () => {
    for (const bad of [
      "https://localtest.me/",
      "https://127.0.0.1.nip.io/",
      "https://prefix.lvh.me/",
    ]) {
      const r = validateExternalHttpUrl(bad);
      expect(r.ok, `expected reject for ${bad}`).toBe(false);
    }
  });

  it("拒绝 zone-id（BIND 风格 ipv6）", () => {
    const r = validateExternalHttpUrl("http://[fe80::1%eth0]/");
    expect(r.ok).toBe(false);
  });

  it("拒绝空 / 解析失败", () => {
    expect(validateExternalHttpUrl("").ok).toBe(false);
    expect(validateExternalHttpUrl("not-a-url").ok).toBe(false);
  });
});

describe("validateOutboundHttpUrl (DNS)", () => {
  beforeEach(() => {
    setSkipDnsForTests(false);
  });
  afterEach(() => {
    setSkipDnsForTests(false);
  });

  it("无 DNS 校验时仍执行静态检查", async () => {
    setSkipDnsForTests(true);
    const r = await validateOutboundHttpUrl("http://example.com/");
    expect(r.ok).toBe(true);
  });

  it("无 DNS 校验时仍拒绝 localhost", async () => {
    setSkipDnsForTests(true);
    const r = await validateOutboundHttpUrl("http://localhost/");
    expect(r.ok).toBe(false);
  });

  it("静态拒绝的字符串不会再走到 DNS", async () => {
    const r = await validateOutboundHttpUrl("file:///etc/passwd");
    expect(r.ok).toBe(false);
  });
});
