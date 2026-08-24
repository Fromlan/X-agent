/**
 * Client logo asset management.
 *
 * Built-in presets are statically enumerated (PNG files in
 * `apps/desktop/public/logos/preset-*.png`); their on-disk path is computed
 * from `app.getAppPath()` so dev and packaged layouts both work.
 *
 * User-uploaded customs land in `~/.pi/agent/x-agent-logos/<uuid>.png` and
 * are served back to the renderer through the `x-agent-logos://` custom
 * protocol (registered in `electron/main.ts`).
 *
 * The active choice lives in `ClientPrefs.clientLogoId`; this module only
 * owns the binary side and exposes a `notifyLogoChange` hook for the runtime
 * to push `IPC_EVENTS.logoChanged` to the renderer.
 */
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type {
  CustomLogo,
  LogoList,
  LogoPreset,
  LogoUploadError,
  LogoUploadResult,
} from "../../shared/ipc";

/** Built-in preset catalog. Order is the render order in the settings grid. */
interface PresetSpec {
  id: string;
  label: string;
  filename: string;
}

const PRESET_SPECS: PresetSpec[] = [
  { id: "preset:01-neon-cyber", label: "霓虹赛博", filename: "preset-01-neon-cyber-1024.webp" },
  { id: "preset:02-lava-burn", label: "熔岩灼烧", filename: "preset-02-lava-burn-1024.webp" },
  { id: "preset:03-plasma-thunder", label: "电浆雷霆", filename: "preset-03-plasma-thunder-1024.webp" },
  { id: "preset:04-holographic-rainbow", label: "全息彩虹", filename: "preset-04-holographic-rainbow-1024.webp" },
  { id: "preset:05-rose-gold-metal", label: "玫瑰金金属", filename: "preset-05-rose-gold-metal-1024.webp" },
  { id: "preset:06-pixel-8bit", label: "像素 8-bit", filename: "preset-06-pixel-8bit-1024.webp" },
  { id: "preset:07-glitch-error", label: "故障 Glitch", filename: "preset-07-glitch-error-1024.webp" },
  { id: "preset:08-cosmic-nebula", label: "宇宙星云", filename: "preset-08-cosmic-nebula-1024.webp" },
];

/** Custom protocol name (registered in electron/main.ts). */
export const LOGO_PROTOCOL = "x-agent-logos";

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB
const MIN_DIM = 64;
const MAX_DIM = 4096;

/** PNG dimensions live in bytes 16–24 of the IHDR chunk. */
function readPngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  const sig = buf.subarray(0, 8);
  const expected = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!sig.equals(expected)) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}

/** JPEG: scan SOF0/SOF2 markers to read dimensions. */
function readJpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    // skip fill bytes
    while (i < buf.length && buf[i] === 0xff) i++;
    if (i >= buf.length) return null;
    const marker = buf[i];
    i++;
    // SOF0 (0xC0) / SOF2 (0xC2) carry the frame size; skip others
    if (marker === 0xc0 || marker === 0xc2) {
      // Layout after marker: length(2) | precision(1) | height(2) | width(2) | ...
      if (i + 7 > buf.length) return null;
      const height = buf.readUInt16BE(i + 3);
      const width = buf.readUInt16BE(i + 5);
      return { width, height };
    }
    // segment length includes the 2 length bytes
    if (i + 2 > buf.length) return null;
    const segLen = buf.readUInt16BE(i);
    i += segLen;
  }
  return null;
}

function readImageSize(filePath: string): { width: number; height: number; format: "png" | "jpeg" | "other" } | null {
  let buf: Buffer;
  try {
    buf = readFileSync(filePath);
  } catch {
    return null;
  }
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) {
    const size = readPngSize(buf);
    return size ? { ...size, format: "png" } : null;
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    const size = readJpegSize(buf);
    return size ? { ...size, format: "jpeg" } : null;
  }
  return null;
}

/** Resolve on-disk path of a built-in preset PNG. */
function resolvePresetPath(filename: string): string {
  // dev: <repo>/apps/desktop/public/logos/<file>
  // packaged: <resourcesPath>/renderer/logos/<file> (Vite copies public/ to renderer root)
  const packaged = app.isPackaged;
  if (packaged) {
    return join(process.resourcesPath, "renderer", "logos", filename);
  }
  return join(app.getAppPath(), "public", "logos", filename);
}

/** Build the renderer-relative URL for a built-in preset (1024 webp). */
function presetUrl(filename: string): string {
  // Vite dev server serves `public/` at root; packaged renderer is loaded
  // from `renderer/index.html` so a relative `./logos/<file>` works in both.
  return `./logos/${filename}`;
}

/** Thumbnail URL (256 webp) for the same preset. */
function presetThumbUrl(filename: string): string {
  // Replace the trailing `-1024.webp` with `-256.webp` to derive the thumb filename.
  return `./logos/${filename.replace(/-1024\.webp$/, "-256.webp")}`;
}

/** List built-in presets that actually exist on disk (graceful if a file is missing). */
export function listPresets(): LogoPreset[] {
  const out: LogoPreset[] = [];
  for (const spec of PRESET_SPECS) {
    const p = resolvePresetPath(spec.filename);
    let width = 1024;
    let height = 1024;
    let sizeBytes = 0;
    try {
      const st = statSync(p);
      sizeBytes = st.size;
    } catch {
      // File missing — still surface the entry so the UI can show the empty
      // slot and warn; renderer handles null/0 dims gracefully.
    }
    out.push({
      id: spec.id,
      label: spec.label,
      url: presetUrl(spec.filename),
      thumbnailUrl: presetThumbUrl(spec.filename),
      width,
      height,
      sizeBytes,
    });
  }
  return out;
}

function customDir(): string {
  const dir = join(app.getPath("home"), ".pi", "agent", "x-agent-logos");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // best effort; unlink/writeFileSync will surface concrete errors
  }
  return dir;
}

/** Custom logo on-disk path for a given id (`"custom:<uuid>"` or just `<uuid>`). */
export function customFilePath(customIdOrUuid: string): string | null {
  const uuid = customIdOrUuid.startsWith("custom:")
    ? customIdOrUuid.slice("custom:".length)
    : customIdOrUuid;
  // defensive: uuid must be a safe filename component
  if (!/^[0-9a-f-]{8,64}$/i.test(uuid)) return null;
  return join(customDir(), `${uuid}.png`);
}

/** Build a CustomLogo descriptor from a file on disk. */
function describeCustom(uuid: string, originalName: string, width: number, height: number, sizeBytes: number, uploadedAt: number): CustomLogo {
  const stamp = new Date(uploadedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const labelStamp = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`;
  const baseName = originalName.replace(/\.[^.]+$/, "");
  return {
    id: `custom:${uuid}`,
    label: `${baseName || "logo"} · ${labelStamp}`,
    // x-agent-logos://custom/<uuid> served by the custom protocol
    url: `${LOGO_PROTOCOL}://custom/${uuid}`,
    fileName: originalName,
    sizeBytes,
    width,
    height,
    uploadedAt,
  };
}

/** List custom logos currently on disk, sorted newest-first. Skips missing files. */
export function listCustoms(): CustomLogo[] {
  const dir = customDir();
  let entries: string[] = [];
  try {
    entries = readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".png"));
  } catch {
    return [];
  }
  const out: CustomLogo[] = [];
  for (const name of entries) {
    const uuid = name.replace(/\.png$/i, "");
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    out.push(
      describeCustom(
        uuid,
        name,
        /* width */ 0,
        /* height */ 0,
        st.size,
        st.mtimeMs,
      ),
    );
  }
  out.sort((a, b) => b.uploadedAt - a.uploadedAt);
  return out;
}

/** Validate, copy, and rewrite the user-picked image as PNG under the customs dir. */
export function saveCustomLogo(sourcePath: string): LogoUploadResult {
  if (typeof sourcePath !== "string" || sourcePath.length === 0) {
    return err("INVALID_FILE", "未提供文件路径");
  }
  if (!existsSync(sourcePath)) {
    return err("INVALID_FILE", "文件不存在");
  }
  let sizeBytes = 0;
  try {
    sizeBytes = statSync(sourcePath).size;
  } catch (e) {
    return err("INVALID_FILE", "无法读取文件信息");
  }
  if (sizeBytes > MAX_BYTES) {
    return err("FILE_TOO_LARGE", `文件超过 ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB 上限`);
  }
  const ext = extname(sourcePath).toLowerCase();
  if (ext !== ".png" && ext !== ".jpg" && ext !== ".jpeg") {
    return err("INVALID_FILE", "仅支持 PNG / JPG");
  }
  const meta = readImageSize(sourcePath);
  if (!meta) {
    return err("INVALID_FILE", "无法识别图片尺寸或文件已损坏");
  }
  if (meta.width < MIN_DIM || meta.height < MIN_DIM) {
    return err("DIM_OUT_OF_RANGE", `图片边长不能小于 ${MIN_DIM}px`);
  }
  if (meta.width > MAX_DIM || meta.height > MAX_DIM) {
    return err("DIM_OUT_OF_RANGE", `图片边长不能大于 ${MAX_DIM}px`);
  }
  // Read the raw bytes. PNG is kept as-is (no re-encoding to preserve quality
  // and stay free of native deps); JPG is re-encoded by the renderer/UI into
  // PNG via canvas before re-uploading — out of scope for this function.
  let bytes: Buffer;
  try {
    bytes = readFileSync(sourcePath);
  } catch {
    return err("WRITE_FAILED", "读取源文件失败");
  }
  const uuid = randomUUID();
  const dest = join(customDir(), `${uuid}.png`);
  try {
    // For JPG uploads, write the bytes unchanged but store as .png; downstream
    // img-tag still renders it (browsers detect by content sniffing). When the
    // re-encode path is added later, this becomes a Sharp/canvas step.
    writeFileSync(dest, bytes);
  } catch (e) {
    return err("WRITE_FAILED", e instanceof Error ? e.message : "写入失败");
  }
  return {
    ok: true,
    logo: describeCustom(uuid, sourcePath.split(/[\\/]/).pop() || "logo.png", meta.width, meta.height, sizeBytes, Date.now()),
  };
}

/** Delete a custom logo from disk. Idempotent (returns ok when file is absent). */
export function deleteCustomLogo(customId: string): { ok: boolean; error?: string; missing: boolean } {
  const file = customFilePath(customId);
  if (!file) {
    return { ok: false, error: "无效的 logo id", missing: true };
  }
  if (!existsSync(file)) {
    return { ok: true, missing: true };
  }
  try {
    unlinkSync(file);
    return { ok: true, missing: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "删除失败", missing: false };
  }
}

/** Compose the full list result for the renderer. */
export function listLogos(activeId: string): LogoList {
  return {
    presets: listPresets(),
    customs: listCustoms(),
    active: activeId,
  };
}

/**
 * Return the absolute file path for a given `clientLogoId`, or `null` if it
 * is `"default"` / unknown / not on disk. Used by main to push setIcon().
 */
export function resolveLogoFilePath(logoId: string): string | null {
  if (!logoId || logoId === "default") return null;
  if (logoId.startsWith("preset:")) {
    const spec = PRESET_SPECS.find((p) => p.id === logoId);
    if (!spec) return null;
    const p = resolvePresetPath(spec.filename);
    return existsSync(p) ? p : null;
  }
  if (logoId.startsWith("custom:")) {
    const p = customFilePath(logoId);
    if (!p) return null;
    return existsSync(p) ? p : null;
  }
  return null;
}

function err(code: LogoUploadError["code"], message: string): LogoUploadError {
  return { ok: false, error: message, code };
}
