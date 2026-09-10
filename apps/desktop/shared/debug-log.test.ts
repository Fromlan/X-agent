/**
 * Vitest unit test for `shared/debug-log.redactString` (defense-in-depth guard
 * against accidental dbgLog(apiKey) leaks).
 *
 * The cross-process dbgLog/dbgWarn/dbgTimer funnels every logged string
 * through redactString before it reaches stdout / DevTools. This test pins
 * the recognised secret shapes so a future maintainer cannot disable the
 * filter without a deliberate, auditable change.
 */
import { describe, it, expect } from "vitest";
import { redactString } from "./debug-log";

describe("redactString (debug-log defense-in-depth)", () => {
  it("redacts an OpenAI-style sk- key", () => {
    expect(redactString("key=sk-abcdefghijklmnopqrstuvwxyz0123456789")).toBe(
      "key=[REDACTED:openai_key]",
    );
  });

  it("redacts an Anthropic-style sk-ant- key", () => {
    expect(redactString("Authorization: sk-ant-api03-AAAA_BBBB_CCCC_DDDD")).toBe(
      "Authorization: [REDACTED:anthropic_key]",
    );
  });

  it("redacts a GitHub PAT (ghp_...)", () => {
    expect(redactString("token ghp_abcDEFghijKLMnopQRSTUVwxyz0123456789")).toBe(
      "token [REDACTED:github_pat]",
    );
  });

  it("redacts a GitHub app/install token (ghs_ / gho_)", () => {
    expect(redactString("ghs_aaaabbbbccccddddeeeeffffgggghhhh")).toBe(
      "[REDACTED:github_app]",
    );
    expect(redactString("gho_aaaabbbbccccddddeeeeffffgggghhhh")).toBe(
      "[REDACTED:github_app]",
    );
  });

  it("redacts a Google API key (AIza...)", () => {
    expect(
      redactString("AIzaSyA-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"),
    ).toBe("[REDACTED:google_api]");
  });

  it("redacts long alphanumeric blobs (>= 64 chars, includes hex and base64)", () => {
    const b64 = "A".repeat(80);
    expect(redactString("cipher=" + b64)).toBe("cipher=[REDACTED:long_blob]");
    const hex = "deadbeef".repeat(10);
    expect(redactString("hash=" + hex)).toBe("hash=[REDACTED:long_blob]");
  });

  it("leaves a normal log line untouched", () => {
    const msg =
      "shadow_recover failed: ENOENT no such file or directory, open /tmp/x";
    expect(redactString(msg)).toBe(msg);
  });

  it("does not redact short alnum blobs (e.g. 40-char git sha)", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    expect(redactString(sha)).toBe(sha);
  });

  it("redacts multiple secrets in the same string", () => {
    const msg =
      "sk-abcdefghijklmnopqrstuvwxyz0123456789 and AIzaSyA-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789";
    const r = redactString(msg);
    expect(r).toContain("[REDACTED:openai_key]");
    expect(r).toContain("[REDACTED:google_api]");
    expect(r).not.toContain("sk-abcdef");
  });
});
