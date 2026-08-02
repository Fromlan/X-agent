import { Download, X } from "lucide-react";
import type { AppUpdateStatus } from "@shared/ipc";

type Props = {
  status: AppUpdateStatus;
  busy: boolean;
  onUpdate: () => void;
  onDismiss: () => void;
};

/** Shell strip when a packaged-app update is available (no auto-download). */
export function UpdateBanner(props: Props) {
  const { status, busy, onUpdate, onDismiss } = props;
  const version = status.version?.trim() || "新版本";
  const downloading = status.downloading;
  const downloaded = status.downloaded;
  const progress =
    typeof status.progress === "number" ? Math.round(status.progress) : null;

  let body: string;
  if (downloading) {
    body =
      progress != null
        ? `正在下载 ${version}（${progress}%）…`
        : `正在下载 ${version}…`;
  } else if (downloaded) {
    body = `${version} 已下载，可安装并重启`;
  } else {
    body = `发现新版本 ${version}`;
  }

  const primaryLabel = downloading
    ? "下载中…"
    : downloaded
      ? "安装并重启"
      : "立即更新";

  return (
    <div className="banner update-banner" role="status">
      <Download size={14} aria-hidden="true" />
      <span className="update-banner-text">{body}</span>
      <div className="update-banner-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || downloading}
          onClick={onUpdate}
        >
          {primaryLabel}
        </button>
        {!downloaded && !downloading && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={onDismiss}
          >
            稍后
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon"
          disabled={busy || downloading}
          onClick={onDismiss}
          title="关闭提示"
          aria-label="关闭更新提示"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
