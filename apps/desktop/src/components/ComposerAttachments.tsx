/**
 * ComposerAttachments —— composer 内部的附件 chip 列表, 显示在 textarea 上方.
 *
 * 两种附件共用同一个区域:
 * - 图片: 缩略图 (base64 data URL) + 移除按钮
 * - 文件: 文件图标 + basename + 移除按钮
 *
 * 两种附件都通过 App.tsx 的 state 管理, 这里只负责渲染.
 */
import { FileText, X } from "lucide-react";
import type { ImageContent } from "../../shared/ipc";
import type { FileReference } from "../lib/file-attachment";

export function ComposerAttachments({
  attachments,
  fileRefs,
  onRemoveImage,
  onRemoveFile,
  maxImageCount,
}: {
  attachments: ImageContent[];
  fileRefs: FileReference[];
  onRemoveImage: (index: number) => void;
  onRemoveFile: (index: number) => void;
  maxImageCount: number;
}) {
  if (attachments.length === 0 && fileRefs.length === 0) return null;
  return (
    <div
      className="composer-attachments"
      role="list"
      aria-label="已附图片与文件"
    >
      {attachments.map((a, i) => (
        <div
          key={`image:${a.mimeType}:${i}`}
          className="composer-attachment-chip"
          role="listitem"
        >
          <img
            src={`data:${a.mimeType};base64,${a.data}`}
            alt=""
            className="composer-attachment-thumb"
          />
          <button
            type="button"
            aria-label="移除图片附件"
            className="composer-attachment-remove"
            onClick={() => onRemoveImage(i)}
          >
            <X size={12} aria-hidden />
          </button>
        </div>
      ))}
      {fileRefs.map((f, i) => (
        <div
          key={`file:${f.absPath}:${i}`}
          className="composer-attachment-chip composer-attachment-chip-file"
          role="listitem"
          title={f.absPath}
        >
          <FileText
            size={20}
            aria-hidden
            className="composer-attachment-file-icon"
          />
          <span className="composer-attachment-file-name">{f.displayName}</span>
          <button
            type="button"
            aria-label={`移除文件附件：${f.displayName}`}
            className="composer-attachment-remove"
            onClick={() => onRemoveFile(i)}
          >
            <X size={12} aria-hidden />
          </button>
        </div>
      ))}
      {(attachments.length > 0 || fileRefs.length > 0) && (
        <span className="composer-attachments-count" aria-live="polite">
          {attachments.length}/{maxImageCount}
          {fileRefs.length > 0 && ` · ${fileRefs.length} 文件`}
        </span>
      )}
    </div>
  );
}
