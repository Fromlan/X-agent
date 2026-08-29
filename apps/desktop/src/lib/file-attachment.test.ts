/**
 * Vitest 套件 —— file → attachment helpers (renderer-side).
 *
 * 锁住 4 个不变量 (#42 composer attachments):
 * 1. SUPPORTED_IMAGE_MIME 白名单 (png/jpeg/gif/webp 之外 → 非图片)
 * 2. MAX_IMAGE_BYTES 单张上限 (4MB)
 * 3. MAX_IMAGE_COUNT 总数上限 (4 张)
 * 4. 非图片走 @<path> 引用, 不读内容塞 prompt
 */
import { describe, it, expect, vi } from "vitest";
import {
  SUPPORTED_IMAGE_MIME,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_COUNT,
  isSupportedImage,
  readFileAsImageContent,
  splitFilesForAttachment,
} from "./file-attachment";

function makeFile(name: string, type: string, sizeBytes: number, path = ""): File {
  // jsdom File doesn't have `path`; cast through unknown to inject.
  const f = new File([new Uint8Array(sizeBytes)], name, { type });
  if (path) (f as unknown as { path: string }).path = path;
  return f;
}

describe("SUPPORTED_IMAGE_MIME 白名单", () => {
  it("接受 png/jpeg/gif/webp", () => {
    expect(SUPPORTED_IMAGE_MIME.has("image/png")).toBe(true);
    expect(SUPPORTED_IMAGE_MIME.has("image/jpeg")).toBe(true);
    expect(SUPPORTED_IMAGE_MIME.has("image/gif")).toBe(true);
    expect(SUPPORTED_IMAGE_MIME.has("image/webp")).toBe(true);
  });

  it("拒绝其他 mime (svg, bmp, heic, octet-stream)", () => {
    expect(SUPPORTED_IMAGE_MIME.has("image/svg+xml")).toBe(false);
    expect(SUPPORTED_IMAGE_MIME.has("image/bmp")).toBe(false);
    expect(SUPPORTED_IMAGE_MIME.has("image/heic")).toBe(false);
    expect(SUPPORTED_IMAGE_MIME.has("application/octet-stream")).toBe(false);
  });
});

describe("isSupportedImage", () => {
  it("true for image/png", () => {
    expect(isSupportedImage(makeFile("a.png", "image/png", 100))).toBe(true);
  });
  it("false for text/csv", () => {
    expect(isSupportedImage(makeFile("a.csv", "text/csv", 100))).toBe(false);
  });
});

describe("readFileAsImageContent", () => {
  it("非支持 mime 返回 null", async () => {
    const f = makeFile("a.svg", "image/svg+xml", 100);
    expect(await readFileAsImageContent(f)).toBeNull();
  });

  it("超大 (>4MB) 返回 null", async () => {
    const f = makeFile("big.png", "image/png", MAX_IMAGE_BYTES + 1);
    expect(await readFileAsImageContent(f)).toBeNull();
  });

  it("正常 PNG 转 base64, 不带 data: 前缀", async () => {
    // Stub FileReader to deterministic output
    const original = globalThis.FileReader;
    class StubFR {
      result: string | null = null;
      error: unknown = null;
      onload: ((ev: unknown) => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      readAsDataURL(_file: File): void {
        this.result = "data:image/png;base64,QUJD";
        queueMicrotask(() => this.onload?.(null));
      }
    }
    globalThis.FileReader = StubFR as unknown as typeof FileReader;
    try {
      const f = makeFile("ok.png", "image/png", 100);
      const out = await readFileAsImageContent(f);
      expect(out).not.toBeNull();
      expect(out!.type).toBe("image");
      expect(out!.data).toBe("QUJD");
      expect(out!.mimeType).toBe("image/png");
    } finally {
      globalThis.FileReader = original;
    }
  });
});

describe("splitFilesForAttachment", () => {
  it("非图片 → references, 不入 images", async () => {
    const f = makeFile("data.csv", "text/csv", 10, "D:/x/data.csv");
    const out = await splitFilesForAttachment([f]);
    expect(out.images).toEqual([]);
    expect(out.references).toEqual(["@D:/x/data.csv "]);
  });

  it("多文件混合: 图片入 images, 非图片入 references", async () => {
    // stub FileReader for image
    const original = globalThis.FileReader;
    class StubFR {
      result: string | null = null;
      onload: ((ev: unknown) => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      readAsDataURL(_file: File): void {
        this.result = "data:image/png;base64,QUJD";
        queueMicrotask(() => this.onload?.(null));
      }
    }
    globalThis.FileReader = StubFR as unknown as typeof FileReader;
    try {
      const png = makeFile("a.png", "image/png", 100);
      const csv = makeFile("b.csv", "text/csv", 50, "D:/b.csv");
      const out = await splitFilesForAttachment([png, csv]);
      expect(out.images).toHaveLength(1);
      expect(out.references).toEqual(["@D:/b.csv "]);
    } finally {
      globalThis.FileReader = original;
    }
  });

  it("超 4 张图: 第 5 张 + 之后走 notice", async () => {
    const original = globalThis.FileReader;
    class StubFR {
      onload: ((ev: unknown) => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      readAsDataURL(_file: File): void {
        queueMicrotask(() =>
          this.onload?.({ target: { result: "data:image/png;base64,X" } } as unknown),
        );
      }
    }
    globalThis.FileReader = StubFR as unknown as typeof FileReader;
    try {
      const files = Array.from({ length: 6 }, (_, i) =>
        makeFile(`f${i}.png`, "image/png", 100),
      );
      const out = await splitFilesForAttachment(files);
      expect(out.images).toHaveLength(MAX_IMAGE_COUNT);
      expect(out.notices.some((n) => n.includes("上限"))).toBe(true);
    } finally {
      globalThis.FileReader = original;
    }
  });

  it("非图片无 path 字段 → 用 f.name 兜底, 不报错", async () => {
    const f = makeFile("only-name.txt", "text/plain", 5);
    const out = await splitFilesForAttachment([f]);
    // jsdom File 没有 path, splitFilesForAttachment 退到 f.name 作 fallback
    expect(out.references).toEqual(["@only-name.txt "]);
  });

  it("超大图片单张 → 进 notices, 不入 images", async () => {
    const big = makeFile("big.png", "image/png", MAX_IMAGE_BYTES + 1);
    const out = await splitFilesForAttachment([big]);
    expect(out.images).toEqual([]);
    expect(out.notices.some((n) => n.includes("图片过大"))).toBe(true);
  });
});
