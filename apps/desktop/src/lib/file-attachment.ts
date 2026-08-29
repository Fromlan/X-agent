/**
 * File → attachment helpers for the composer.
 *
 * Three public entry points:
 * - `readFileAsImageContent(file)` —— read a single File, return
 *   ImageContent or null if the file isn't a supported image.
 * - `splitFilesForAttachment(items)` —— classify `{file, absPath}[]`
 *   into images (returned) and references (returned as `<file>`
 *   blocks appended to input text by the caller).
 * - `MAX_IMAGE_BYTES` / `MAX_IMAGE_COUNT` —— caller-side gates
 *   that match this module's enforcement.
 *
 * The renderer is the only consumer; the image payload is sent
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

/**
 * Input to `splitFilesForAttachment`. The renderer pre-resolves the
 * absolute path via `webUtils.getPathForFile(file)` (Electron 32+ no
 * longer auto-attaches `file.path` for cross-origin security), and
 * passes both the File and the absolute path so this module stays a
 * pure function with no DOM/Electron coupling.
 */
export interface FileInput {
  file: File;
  /** Absolute path on disk. Empty string if Electron could not resolve. */
  absPath: string;
  /** Optional short name override (e.g. `f.name`) when absPath is empty. */
  fallbackName?: string;
}

/**
 * A dropped/pasted non-image file. Carries the basename for short
 * display in the composer, plus the absolute path the model needs
 * to `read` it. Composer shows `📎 <basename>`; the absolute path
 * flows out-of-band to the send pipeline so the model sees it.
 */
export interface FileReference {
  /** Absolute path on disk (empty if Electron could not resolve). */
  absPath: string;
  /** Basename (e.g. "01_chess_pieces.csv"). */
  displayName: string;
}

/** Result of splitting dropped / pasted files into image vs reference. */
export interface AttachmentSplit {
  /** Image attachments ready to be added to `ImageContent[]`. */
  images: ImageContent[];
  /**
   * File references. Caller decides how to surface them in the
   * composer (short chip, `<file>` block, etc.) and how to ship the
   * absolute path to the model (PromptPayload extensions, separate
   * send pipeline, etc.).
   */
  references: FileReference[];
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
 * Classify a list of file inputs. The first MAX_IMAGE_COUNT supported
 * images are returned as `ImageContent[]` (oversize and unsupported
 * image types drop a notice); non-image files become `<file>`
 * reference blocks in `references`.
 *
 * Notice strings are user-facing (suitable for `setError` or a
 * composer banner). Empty when nothing was skipped.
 */
export async function splitFilesForAttachment(
  items: FileInput[],
): Promise<AttachmentSplit> {
  const images: ImageContent[] = [];
  const references: FileReference[] = [];
  const notices: string[] = [];
  let imageSkipped = 0;
  for (const { file, absPath, fallbackName } of items) {
    const displayName = basename(absPath || fallbackName || file.name);
    if (isSupportedImage(file)) {
      if (images.length >= MAX_IMAGE_COUNT) {
        imageSkipped += 1;
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        notices.push(
          `图片过大（${formatBytes(file.size)} > ${formatBytes(MAX_IMAGE_BYTES)}），已跳过：${displayName}`,
        );
        continue;
      }
      try {
        const content = await readFileAsImageContent(file);
        if (content) {
          images.push(content);
          continue;
        }
        notices.push(`图片读取失败，已跳过：${displayName}`);
      } catch {
        notices.push(`图片读取失败，已跳过：${displayName}`);
      }
      continue;
    }
    // Non-image: emit structured FileReference. Caller renders
    // `📎 <displayName>` in composer (short) and ships `<absPath>` to
    // the model out-of-band (e.g. via `<file>` block appended to
    // expanded prompt). Keeps the composer free of long paths while
    // preserving the model-side reference.
    const refPath = absPath || fallbackName || file.name;
    if (!refPath) {
      notices.push(`文件无路径，已跳过：${file.name}`);
      continue;
    }
    references.push({
      absPath: refPath,
      displayName,
    });
  }
  if (imageSkipped > 0) {
    notices.push(`已达图片上限 ${MAX_IMAGE_COUNT} 张，跳过 ${imageSkipped} 张`);
  }
  return { images, references, notices };
}

/** Cross-platform basename for the renderer (no `path` module available). */
function basename(p: string): string {
  if (!p) return "";
  // Strip both Unix and Windows separators, take last segment.
  const m = /([^/\\]+)[/\\]*$/.exec(p);
  return m ? m[1]! : p;
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
