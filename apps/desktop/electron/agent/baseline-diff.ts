/**
 * baseline-diff —— 无 Git 降级的 diff 计算。
 * 输入 TurnFileTracker 的 write/edit 字节基线（before），对比当前盘上内容（after），
 * 用 jsdiff 生成与 git 同构的 unified diff 文本，供 DiffView 复用。
 * 有 Git（shadow 检查点可用）时本模块不会被调用；仅作为无 Git 环境的降级路径。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTwoFilesPatch } from "diff";

/** 单文件参与内容 diff 的大小上限（jsdiff Myers 在大文本上 O(N²) 退化）。 */
export const MAX_DIFF_FILE_BYTES = 512 * 1024;
/** 拼接后的 diff 文本上限（与 shadow-git 的 IPC 载荷上限一致）。 */
export const BASELINE_DIFF_TEXT_MAX_BYTES = 256 * 1024;

/** 与 turn-file-tracker 的 BaselineEntry 结构兼容（结构类型自动匹配）。 */
export type BaselineEntry =
  | { kind: "file"; bytes: Buffer }
  | { kind: "absent" }
  | { kind: "symlink"; target: string };

export type BaselineDiffSkipReason = "binary" | "too_large" | "unchanged";

/** 单文件对比结果：产出 diff 或标记跳过原因。 */
export type BaselineFileDiff =
  | { diffText: string }
  | { skipped: BaselineDiffSkipReason };

/**
 * 二进制检测：含 NUL 或 UTF-8 解码出现替换字符（U+FFFD）视为非文本。
 * 二进制文件不做内容 diff（避免乱码与无意义高亮），但路径仍会出现在文件列表。
 */
export function isTextLikeBuffer(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  return !buf.toString("utf8").includes("\uFFFD");
}

/**
 * 清洗 jsdiff 输出为 git 同构格式：
 * 去掉 `Index: x` / `=====` 横幅与 `---/+++` 行尾的 tab，前置 `diff --git` 头。
 */
export function toGitStylePatch(rel: string, before: string, after: string): string {
  const patch = createTwoFilesPatch(rel, rel, before, after, "", "", {
    context: 3,
  });
  const body = patch
    .replace(/^Index: .*\r?\n/, "")
    .replace(/^=+\r?\n/, "")
    .replace(/^(\+\+\+|---) ([^\t]*)\t?$/gm, "$1 $2");
  return `diff --git a/${rel} b/${rel}\n${body}`;
}

/**
 * 单文件 before(基线) vs after(当前盘上) 对比。
 * 覆盖：修改 / 新增（absent→内容）/ 删除（内容→absent）/
 * 无变化 / 二进制 / 超限 / symlink（不产出内容 diff）。
 */
export function baselineDiffTextForEntry(
  rel: string,
  entry: BaselineEntry,
  cwd: string,
): BaselineFileDiff {
  const normRel = rel.replace(/\\/g, "/");
  const abs = join(cwd, rel);

  // before 侧（基线）
  let beforeText = "";
  if (entry.kind === "file") {
    if (entry.bytes.length > MAX_DIFF_FILE_BYTES) return { skipped: "too_large" };
    if (!isTextLikeBuffer(entry.bytes)) return { skipped: "binary" };
    beforeText = entry.bytes.toString("utf8");
  } else if (entry.kind === "symlink") {
    // symlink 还原只是重建链接，内容 diff 无意义
    return { skipped: "binary" };
  }
  // kind === "absent"：before 保持不存在

  // after 侧（当前盘上）
  const afterExists = existsSync(abs);
  let afterExistsFlag = afterExists;
  let afterText = "";
  if (afterExists) {
    try {
      const buf = readFileSync(abs);
      if (buf.length > MAX_DIFF_FILE_BYTES) return { skipped: "too_large" };
      if (!isTextLikeBuffer(buf)) return { skipped: "binary" };
      afterText = buf.toString("utf8");
    } catch {
      afterExistsFlag = false;
    }
  }

  // 内容完全相同（含"空内容 vs 不存在"这类无内容可展示的情况）→ 无变化
  if (beforeText === afterText) return { skipped: "unchanged" };
  return { diffText: toGitStylePatch(normRel, beforeText, afterText) };
}

/**
 * 行对齐截断（保留头部，避免 IPC / renderer 载荷过大）。
 * shadow-git 与基线 diff 共用的唯一实现。
 */
export function truncateDiffText(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return { text, truncated: false };
  }
  const lines = text.split("\n");
  const kept: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, "utf8") + 1; // + 换行
    if (bytes + lineBytes > maxBytes) break;
    kept.push(line);
    bytes += lineBytes;
  }
  return { text: kept.join("\n"), truncated: true };
}

/**
 * 多文件 diff 拼接 + 行对齐截断。
 */
export function joinBaselineDiffs(
  parts: Array<{ rel: string; diffText: string }>,
  maxBytes: number = BASELINE_DIFF_TEXT_MAX_BYTES,
): { diffText: string; truncated?: boolean } {
  if (parts.length === 0) return { diffText: "" };
  const text = parts.map((p) => p.diffText).join("\n");
  const { text: diffText, truncated } = truncateDiffText(text, maxBytes);
  return truncated ? { diffText, truncated: true } : { diffText };
}
