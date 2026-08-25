/**
 * LogoPicker —— 设置页的「品牌」block 内容。
 *
 * - 顶部：4 列 × 2 行 内置预设缩略图网格
 * - 下方：用户上传的 custom logo 列表
 * - 底部：上传 / 恢复默认 操作按钮
 * - 选中态有 accent 边框 + 勾选标记
 *
 * 静态缩略图是 base 64 KB 量级，1024×1024 完整 PNG 直接当 src，
 * 浏览器自己按 CSS `width/height` 缩小即可。
 */
import { useState } from "react";
import { Upload, Trash2, RotateCcw, Image as ImageIcon, Check } from "lucide-react";
import { useConfirm } from "../../lib/app-confirm";
import type { LogoList } from "@shared/ipc";
import type { UseLogoResult } from "../../hooks/useLogo";

type Props = {
  list: LogoList | null;
  activeId: string;
  busy: boolean;
  controller: UseLogoResult;
  onError: (message: string | null) => void;
};

export function LogoPicker({
  list,
  activeId,
  busy,
  controller,
  onError,
}: Props) {
  const confirm = useConfirm();
  const [localBusy, setLocalBusy] = useState<"upload" | "clear" | null>(null);

  const handleUpload = async () => {
    setLocalBusy("upload");
    onError(null);
    try {
      const result = await controller.upload();
      if (!result.ok && result.error !== "已取消") {
        onError(`上传失败：${result.error}`);
      }
    } finally {
      setLocalBusy(null);
    }
  };

  const handleClear = async (customId: string, label: string) => {
    const ok = await confirm({
      title: "删除自定义 logo",
      message: `确认删除「${label}」？此操作不可撤销。`,
      confirmLabel: "删除",
      tone: "danger",
    });
    if (!ok) return;
    setLocalBusy("clear");
    onError(null);
    try {
      const result = await controller.clear(customId);
      if (!result.ok) onError(`删除失败：${result.error ?? "未知错误"}`);
    } finally {
      setLocalBusy(null);
    }
  };

  const handleRevertDefault = () => {
    void controller.setActive("default");
  };

  const isActive = (id: string) => activeId === id;

  return (
    <div className="logo-picker">
      <div className="logo-grid" role="radiogroup" aria-label="内置 logo 预设">
        {list?.presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={isActive(preset.id)}
            className={`logo-tile${isActive(preset.id) ? " is-active" : ""}`}
            onClick={() => void controller.setActive(preset.id)}
            disabled={busy || localBusy !== null}
            title={preset.label}
          >
            <img
              src={preset.thumbnailUrl ?? preset.url}
              alt={preset.label}
              width={64}
              height={64}
              loading="lazy"
              draggable={false}
            />
            <span className="logo-tile-label">{preset.label}</span>
            {isActive(preset.id) && (
              <span className="logo-tile-check" aria-hidden="true">
                <Check size={12} />
              </span>
            )}
          </button>
        ))}
      </div>

      {list && list.customs.length > 0 && (
        <div className="logo-customs">
          <h5 className="logo-customs-title">我的上传</h5>
          <div className="logo-customs-list">
            {list.customs.map((custom) => (
              <div
                key={custom.id}
                className={`logo-custom-row${isActive(custom.id) ? " is-active" : ""}`}
              >
                <button
                  type="button"
                  className="logo-custom-thumb-btn"
                  onClick={() => void controller.setActive(custom.id)}
                  disabled={busy || localBusy !== null}
                  aria-pressed={isActive(custom.id)}
                  title={custom.label}
                >
                  <img
                    src={custom.url}
                    alt={custom.label}
                    width={32}
                    height={32}
                    loading="lazy"
                    draggable={false}
                  />
                  <span className="logo-custom-label">{custom.label}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  onClick={() => void handleClear(custom.id, custom.label)}
                  disabled={busy || localBusy !== null}
                  aria-label={`删除 ${custom.label}`}
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="logo-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleUpload}
          disabled={busy || localBusy !== null}
        >
          <Upload size={14} />
          <span className="btn-label">
            {localBusy === "upload" ? "上传中…" : "上传自定义…"}
          </span>
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={handleRevertDefault}
          disabled={busy || activeId === "default" || localBusy !== null}
        >
          <RotateCcw size={14} />
          <span className="btn-label">恢复默认</span>
        </button>
        <span className="logo-active-hint" aria-live="polite">
          <ImageIcon size={12} />
          <span>
            当前：
            {list?.presets.find((p) => p.id === activeId)?.label ??
              list?.customs.find((c) => c.id === activeId)?.label ??
              "默认"}
          </span>
        </span>
      </div>
    </div>
  );
}
