/**
 * ComposerAttachments —— 缩略图 + chip 列表, 显示在 textarea 上方.
 *
 * 用户从剪贴板 / 拖放拿到图片后, 这里渲染缩略图 + 移除按钮.
 * 非图片走 @<path> 引用注入到 textarea 文本, 不显示在这里.
 */
import { X } from "lucide-react";
import type { ImageContent } from "../../shared/ipc";

export function ComposerAttachments({
  attachments,
  onRemove,
  maxCount,
}: {
  attachments: ImageContent[];
  onRemove: (index: number) => void;
  maxCount: number;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="composer-attachments" role="list" aria-label="已附图片">
      {attachments.map((a, i) => (
        <div
          key={`${a.mimeType}:${i}`}
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
            aria-label="移除附件"
            className="composer-attachment-remove"
            onClick={() => onRemove(i)}
          >
            <X size={12} aria-hidden />
          </button>
        </div>
      ))}
      <span className="composer-attachments-count" aria-live="polite">
        {attachments.length}/{maxCount}
      </span>
    </div>
  );
}
