/** Match the reference's single title bar: product identity, drag surface and native window actions. */
import { memo } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import type { AppWindowAction } from "@shared/ipc";

interface Props {
  maximized: boolean;
  onWindowAction: (action: AppWindowAction) => Promise<void>;
}

/** Buttons explicitly opt out of the draggable region and call only the guarded workspace bridge. */
function TopBarImpl({ maximized, onWindowAction }: Props) {
  return (
    <header className="topbar">
      <div className="topbar-brand" aria-label="X-agent">
        <svg className="brand-mark" viewBox="0 0 28 28" aria-hidden>
          <path d="M3 3h7l7 8-4 5L3 5zm16 0h6L10 25H3zm0 15 6 7h-7l-3-3z" fill="currentColor" />
        </svg>
        <span>X-agent</span>
      </div>
      <div className="window-controls">
        <button type="button" aria-label="最小化窗口" title="最小化" onClick={() => void onWindowAction("minimize")}><Minus size={17} aria-hidden /></button>
        <button type="button" aria-label={maximized ? "还原窗口" : "最大化窗口"} title={maximized ? "还原" : "最大化"} onClick={() => void onWindowAction("toggleMaximize")}>
          {maximized ? <Copy size={15} aria-hidden /> : <Square size={15} aria-hidden />}
        </button>
        <button type="button" className="window-close" aria-label="关闭窗口" title="关闭" onClick={() => void onWindowAction("close")}><X size={20} aria-hidden /></button>
      </div>
    </header>
  );
}

export const TopBar = memo(TopBarImpl);
