/**
 * Vitest suite covering agent-logos.ts:
 *   - preset enumeration + path resolution
 *   - custom logo validation (size / dim / format)
 *   - idempotent delete + uuid whitelist
 *   - resolveLogoFilePath across default / unknown / missing / custom branches
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: (key) => {
      if (key === "home") return process.env.HOME ?? homedir();
      return process.cwd();
    },
  },
}));

import {
  listPresets,
  listCustoms,
  saveCustomLogo,
  deleteCustomLogo,
  customFilePath,
  resolveLogoFilePath,
  listLogos,
  LOGO_PROTOCOL,
} from "./agent-logos";

let work = "";
let fakeHome = "";

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "x-agent-logos-vitest-"));
  fakeHome = mkdtempSync(join(tmpdir(), "x-agent-home-"));
  process.env.HOME = fakeHome;
});

afterAll(() => {
  try {
    rmSync(work, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

beforeEach(() => {
  // Wipe customs between cases so the mtime-ordering test is deterministic.
  const dir = join(fakeHome, ".pi", "agent", "x-agent-logos");
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

/** Write a real 64x64 transparent PNG to `path`. */
function write64x64Png(path: string) {
  const fs = require("node:fs") as typeof import("node:fs");
  const src = join(__dirname, "__test-assets", "64x64-transparent.png");
  writeFileSync(path, fs.readFileSync(src));
}

/** Write a real 64x64 white JPEG to `path`. */
function write64x64Jpeg(path: string) {
  const fs = require("node:fs") as typeof import("node:fs");
  const src = join(__dirname, "__test-assets", "64x64.jpg");
  writeFileSync(path, fs.readFileSync(src));
}

describe("agent-logos / listPresets", () => {
  it("enumerates all 8 presets with the expected URL shape", () => {
    const presets = listPresets();
    expect(presets).toHaveLength(8);
    expect(presets[0]!.id).toBe("preset:01-neon-cyber");
    expect(presets[0]!.label).toBe("霓虹赛博");
    expect(presets[0]!.url).toBe("./logos/preset-01-neon-cyber.png");
    expect(presets[7]!.id).toBe("preset:08-cosmic-nebula");
  });
});

describe("agent-logos / saveCustomLogo", () => {
  it("accepts a valid PNG and writes to the customs dir", () => {
    const src = join(work, "ok.png");
    write64x64Png(src);
    const result = saveCustomLogo(src);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.logo.id.startsWith("custom:")).toBe(true);
      expect(result.logo.width).toBe(64);
      expect(result.logo.height).toBe(64);
      expect(result.logo.sizeBytes).toBeGreaterThan(0);
      expect(result.logo.url).toMatch(/^x-agent-logos:\/\/custom\//);
      const dest = customFilePath(result.logo.id);
      expect(dest).not.toBeNull();
      expect(existsSync(dest!)).toBe(true);
    }
  });

  it("rejects a missing file", () => {
    const result = saveCustomLogo(join(work, "missing.png"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_FILE");
  });

  it("rejects a non-image extension", () => {
    const src = join(work, "fake.txt");
    writeFileSync(src, "hello");
    const result = saveCustomLogo(src);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_FILE");
  });

  it("rejects files larger than 4MB", () => {
    const src = join(work, "huge.png");
    writeFileSync(src, Buffer.alloc(5 * 1024 * 1024, 0));
    const result = saveCustomLogo(src);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FILE_TOO_LARGE");
  });

  it("rejects PNGs whose decoded dimensions are out of range", () => {
    const src = join(work, "garbage.png");
    // Valid PNG signature + 0x42 padding => IHDR width/height = 0x42424242 (huge)
    writeFileSync(
      src,
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(100, 0x42),
      ]),
    );
    const result = saveCustomLogo(src);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DIM_OUT_OF_RANGE");
  });

  it("accepts a valid JPEG and writes it as .png", () => {
    const src = join(work, "ok.jpg");
    write64x64Jpeg(src);
    const result = saveCustomLogo(src);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const dest = customFilePath(result.logo.id);
      expect(dest!.endsWith(".png")).toBe(true);
      expect(existsSync(dest!)).toBe(true);
    }
  });
});

describe("agent-logos / deleteCustomLogo", () => {
  it("deletes an existing custom logo", () => {
    const src = join(work, "to-del.png");
    write64x64Png(src);
    const saved = saveCustomLogo(src);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const del = deleteCustomLogo(saved.logo.id);
    expect(del.ok).toBe(true);
    expect(del.missing).toBe(false);
    expect(existsSync(customFilePath(saved.logo.id)!)).toBe(false);
  });

  it("is idempotent when the file is already gone", () => {
    // Use a valid-looking uuid so the regex whitelist passes; the file just doesn't exist.
    const del = deleteCustomLogo("custom:00000000-0000-0000-0000-000000000000");
    expect(del.ok).toBe(true);
    expect(del.missing).toBe(true);
  });

  it("rejects path-traversal-style ids", () => {
    const del = deleteCustomLogo("custom:../etc/passwd");
    expect(del.ok).toBe(false);
  });
});

describe("agent-logos / customFilePath", () => {
  it("rejects path traversal in uuid", () => {
    expect(customFilePath("custom:../etc/passwd")).toBeNull();
    expect(customFilePath("custom:foo/../bar")).toBeNull();
    expect(customFilePath("custom:")).toBeNull();
  });

  it("returns ~/.pi/agent/x-agent-logos/<uuid>.png for a valid uuid", () => {
    const p = customFilePath("custom:7f3c0a4d-1234-5678-9abc-def012345678");
    expect(p).not.toBeNull();
    expect(p!.replace(/\\/g, "/")).toContain(".pi/agent/x-agent-logos/7f3c0a4d-1234-5678-9abc-def012345678.png");
  });
});

describe("agent-logos / resolveLogoFilePath", () => {
  it("returns null for default", () => {
    expect(resolveLogoFilePath("default")).toBeNull();
  });

  it("returns null for unknown ids", () => {
    expect(resolveLogoFilePath("preset:99-fake")).toBeNull();
    expect(resolveLogoFilePath("garbage")).toBeNull();
  });

  it("returns null for an unknown preset id even if other presets exist on disk", () => {
    // preset:01 exists in the workspace (we copied the 8 PNGs to public/logos/);
    // an out-of-range preset id should still return null without throwing.
    expect(resolveLogoFilePath("preset:99-fake")).toBeNull();
  });

  it("returns an absolute path when a custom id hits the disk", () => {
    const src = join(work, "r.png");
    write64x64Png(src);
    const saved = saveCustomLogo(src);
    if (!saved.ok) throw new Error("setup failed");
    const p = resolveLogoFilePath(saved.logo.id);
    expect(p).not.toBeNull();
    expect(existsSync(p!)).toBe(true);
  });
});

describe("agent-logos / listLogos", () => {
  it("returns {presets, customs, active}", () => {
    const out = listLogos("default");
    expect(Array.isArray(out.presets)).toBe(true);
    expect(out.presets).toHaveLength(8);
    expect(Array.isArray(out.customs)).toBe(true);
    expect(out.active).toBe("default");
  });

  it("orders customs newest-first by mtime", () => {
    const a = join(work, "a.png");
    const b = join(work, "b.png");
    write64x64Png(a);
    write64x64Png(b);
    const ra = saveCustomLogo(a);
    const rb = saveCustomLogo(b);
    if (!ra.ok || !rb.ok) throw new Error("setup failed");
    // Force mtime ordering: a older, b newer
    const ua = customFilePath(ra.logo.id)!;
    const ub = customFilePath(rb.logo.id)!;
    const earlier = new Date(Date.now() - 60_000);
    const later = new Date(Date.now());
    const fs = require("node:fs") as typeof import("node:fs");
    fs.utimesSync(ua, earlier, earlier);
    fs.utimesSync(ub, later, later);
    const out = listLogos("default");
    expect(out.customs.length).toBe(2);
    // Newest first => b (later mtime) is customs[0]
    expect(out.customs[0]!.id).toBe(rb.logo.id);
    expect(out.customs[1]!.id).toBe(ra.logo.id);
    expect(out.customs[0]!.uploadedAt).toBeGreaterThanOrEqual(
      out.customs[1]!.uploadedAt,
    );
  });
});

describe("agent-logos / LOGO_PROTOCOL", () => {
  it("protocol name is x-agent-logos", () => {
    expect(LOGO_PROTOCOL).toBe("x-agent-logos");
  });
});
