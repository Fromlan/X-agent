/**
 * File → attachment helpers for the composer.
 *
 * Three public entry points:
 * - `readFileAsImageContent(file)` —— read a single File, return
 *   ImageContent or null if the file isn't a supported image.
 * - `splitFilesForAttachment(files)` —— classify into images
 *   (returned) and non-image paths (returned for `@<path>` 注入
 *   input text by the caller).
 * - `MAX_IMAGE_BYTES` / `MAX_IMAGE_COUNT` —— caller-side gates
 *   that match this module's enforcement.
 *
 * The renderer is the only consumer; the file payload is sent
 * over IPC as part of `PromptPayload.images`.
 */
import type { ImageContent } from "../../shared/ipc";

/** Whitelisted mime types. Anything else is treated as non-image. */
export const SUPPORTED_IMAGE_MIME = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** Single-image size cap (raw bytes). 4 MB ≈ 3 MB base64 with overhead. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Hard cap on the number of images per prompt. */
export const MAX_IMAGE_COUNT = 4;

/** Result of splitting dropped / pasted files into image vs reference. */
export interface AttachmentSplit {
  /** Image attachments ready to be added to `ImageContent[]`. */
  images: ImageContent[];
  /** Paths / references that should be appended to the input text as `@<path>`. */
  references: string[];
  /** Notes for the user (skipped files with reasons). */
  notices: string[];
}

/** True if the browser File object represents a supported image type. */
export function isSupportedImage(file: File): boolean {
  return SUPPORTED_IMAGE_MIME.has(file.type);
}

/**
 * Read a single File as base64 (no `data:` URL prefix) and return an
 * ImageContent. Returns null if the file isn't a supported image or
 * exceeds the size cap.
 */
export async function readFileAsImageContent(
  file: File,
): Promise<ImageContent | null> {
  if (!isSupportedImage(file)) return null;
  if (file.size > MAX_IMAGE_BYTES) return null;
  const dataUrl = await readAsDataUrl(file);
  // dataUrl looks like "data:image/png;base64,XXXX" — keep only the body.
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return { type: "image", data: base64, mimeType: file.type };
}

/**
 * Classify a list of files. The first MAX_IMAGE_COUNT supported
 * images are returned as `ImageContent[]` (oversize and unsupported
 * image types drop a notice); non-image files become `@<path>`
 * references in `references`.
 *
 * Notice strings are user-facing (suitable for `setError` or a
 * composer banner). Empty when nothing was skipped.
 */
export async function splitFilesForAttachment(
  files: File[],
): Promise<AttachmentSplit> {
  const images: ImageContent[] = [];
  const references: string[] = [];
  const notices: string[] = [];
  let imageSkipped = 0;
  for (const f of files) {
    if (isSupportedImage(f)) {
      if (images.length >= MAX_IMAGE_COUNT) {
        imageSkipped += 1;
        continue;
      }
      if (f.size > MAX_IMAGE_BYTES) {
        notices.push(
          `图片过大（${formatBytes(f.size)} > ${formatBytes(MAX_IMAGE_BYTES)}），已跳过：${f.name}`,
        );
        continue;
      }
      try {
        const content = await readFileAsImageContent(f);
        if (content) {
          images.push(content);
          continue;
        }
        notices.push(`图片读取失败，已跳过：${f.name}`);
      } catch {
        notices.push(`图片读取失败，已跳过：${f.name}`);
      }
      continue;
    }
    // Non-image: append `@<path>` reference. Renderer-side path may
    // be `file.path` (Electron exposes it on dropped files) or empty.
    const path = (f as unknown as { path?: string }).path ?? f.name;
    if (path) references.push(`@${path} `);
  }
  if (imageSkipped > 0) {
    notices.push(`已达图片上限 ${MAX_IMAGE_COUNT} 张，跳过 ${imageSkipped} 张`);
  }
  return { images, references, notices };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
