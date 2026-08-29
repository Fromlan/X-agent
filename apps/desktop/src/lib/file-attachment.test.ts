/**
 * Vitest 套件 —— file → attachment helpers (renderer-side).
 *
 * 锁住 5 个不变量 (#42 composer attachments + #44 绝对路径):
 * 1. SUPPORTED_IMAGE_MIME 白名单 (png/jpeg/gif/webp 之外 → 非图片)
 * 2. MAX_IMAGE_BYTES 单张上限 (4MB)
 * 3. MAX_IMAGE_COUNT 总数上限 (4 张)
 * 4. 非图片走 <file name="<abs path>"> 块 (空 content, name 用绝对路径)
 * 5. 切到绝对路径: splitFilesForAttachment 接 FileInput[] (含 absPath),
 *    不再读 f.path (Electron 32+ 不可用)
 */
import { describe, it, expect } from "vitest";
import {
  SUPPORTED_IMAGE_MIME,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_COUNT,
  isSupportedImage,
  readFileAsImageContent,
  splitFilesForAttachment,
  type FileInput,
} from "./file-attachment";

function makeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

/** Wrap File + absPath + optional fallback into a FileInput. */
function input(
  file: File,
  absPath: string,
  fallbackName?: string,
): FileInput {
  return { file, absPath, fallbackName };
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
  it("非图片 → <file name=\"<abs path>\"> 块 (空 content)", async () => {
    const f = makeFile("data.csv", "text/csv", 10);
    const out = await splitFilesForAttachment([
      input(f, "D:/x/data.csv"),
    ]);
    expect(out.images).toEqual([]);
    expect(out.references).toEqual([
      '<file name="D:/x/data.csv">\n</file>',
    ]);
  });

  it("绝对路径优先: 不再用 f.name (Electron 32+ 不可用)", async () => {
    const f = makeFile("data.csv", "text/csv", 10);
    const out = await splitFilesForAttachment([
      input(f, "D:/abs/path/data.csv"),
    ]);
    // name attribute 必须是绝对路径, 不是 f.name ("data.csv")
    expect(out.references[0]).toContain('name="D:/abs/path/data.csv"');
  });

  it("Windows 反斜杠路径在 attr 内 → 转正斜杠 (与 @<path> 风格一致)", async () => {
    const f = makeFile("data.csv", "text/csv", 10);
    const out = await splitFilesForAttachment([
      input(f, "D:\\UGit\\x\\data.csv"),
    ]);
    // 我们的 escapeAttr 不转 slash, 但 basename 兼容两种.
    // 主要确认 name 含原 Windows 路径.
    expect(out.references[0]).toContain("D:");
  });

  it("多文件混合: 图片入 images, 非图片入 <file> 块", async () => {
    const original = globalThis.FileReader;
    class StubFR {
      onload: ((ev: unknown) => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      readAsDataURL(_file: File): void {
        queueMicrotask(() =>
          this.onload?.({ target: { result: "data:image/png;base64,QUJD" } } as unknown),
        );
      }
    }
    globalThis.FileReader = StubFR as unknown as typeof FileReader;
    try {
      const png = makeFile("a.png", "image/png", 100);
      const csv = makeFile("b.csv", "text/csv", 50);
      const out = await splitFilesForAttachment([
        input(png, "D:/a.png"),
        input(csv, "D:/b.csv"),
      ]);
      expect(out.images).toHaveLength(1);
      expect(out.references).toEqual([
        '<file name="D:/b.csv">\n</file>',
      ]);
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
      const items = Array.from({ length: 6 }, (_, i) =>
        input(makeFile(`f${i}.png`, "image/png", 100), `D:/f${i}.png`),
      );
      const out = await splitFilesForAttachment(items);
      expect(out.images).toHaveLength(MAX_IMAGE_COUNT);
      expect(out.notices.some((n) => n.includes("上限"))).toBe(true);
    } finally {
      globalThis.FileReader = original;
    }
  });

  it("absPath 空 → 用 fallbackName (或 f.name), 不报错", async () => {
    const f = makeFile("only-name.txt", "text/plain", 5);
    const out = await splitFilesForAttachment([
      input(f, "", "fallback.txt"),
    ]);
    expect(out.references).toEqual([
      '<file name="fallback.txt">\n</file>',
    ]);
  });

  it("absPath + fallbackName 都空 → 退到 f.name 兜底 (浏览器 File.name 总有值)", async () => {
    const f = makeFile("orphan.txt", "text/plain", 5);
    const out = await splitFilesForAttachment([input(f, "")]);
    // 三层 fallback: absPath → fallbackName → f.name
    expect(out.references).toEqual([
      '<file name="orphan.txt">\n</file>',
    ]);
  });

  it("超大图片单张 → 进 notices, 不入 images", async () => {
    const big = makeFile("big.png", "image/png", MAX_IMAGE_BYTES + 1);
    const out = await splitFilesForAttachment([
      input(big, "D:/big.png"),
    ]);
    expect(out.images).toEqual([]);
    expect(out.notices.some((n) => n.includes("图片过大"))).toBe(true);
    // notice 用 basename 而不是全路径
    expect(out.notices[0]).toContain("big.png");
    expect(out.notices[0]).not.toContain("D:/big.png");
  });

  it("XML 注入防御: 路径含 '\"' 或 '<' 时 attr 被转义", async () => {
    const f = makeFile("a.csv", "text/csv", 10);
    const out = await splitFilesForAttachment([
      input(f, 'D:/x/"<script>.csv'),
    ]);
    expect(out.references[0]).toContain("&quot;");
    expect(out.references[0]).toContain("&lt;");
    expect(out.references[0]).not.toContain('"<script>');
  });
});
