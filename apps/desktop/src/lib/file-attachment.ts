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

/** Result of splitting dropped / pasted files into image vs reference. */
export interface AttachmentSplit {
  /** Image attachments ready to be added to `ImageContent[]`. */
  images: ImageContent[];
  /**
   * `<file name="<abs path>">\n</file>` blocks (empty content). Pushed
   * into the composer input verbatim. User message renderer collapses
   * these to a chip with basename + tooltip = full path. The absolute
   * path is preserved in the `name` attribute so the model can use
   * the `read` tool with the full path.
   */
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
  const references: string[] = [];
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
    // Non-image: emit `<file name="<abs path>">\n</file>` block. The
    // block name carries the absolute path so the model can `read` it.
    // expandAtPaths does not touch pre-existing `<file>` blocks, so
    // this round-trips verbatim. The renderer collapses it to a chip
    // showing the basename (full path in tooltip).
    const ref = absPath || fallbackName || file.name;
    if (!ref) {
      notices.push(`文件无路径，已跳过：${file.name}`);
      continue;
    }
    references.push(`<file name="${escapeAttr(ref)}">\n</file>`);
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

/** Escape `<` / `>` / `"` / `&` for safe insertion into XML-ish attributes. */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
