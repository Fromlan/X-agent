/** Synchronize the custom title bar with native maximize state and the package version. */
import { useCallback, useEffect, useState } from "react";
import type { AppWindowAction, AppWindowInfo } from "@shared/ipc";

/** Read state after native resizes as well as button commands so drag and keyboard actions stay accurate. */
export function useWindowChrome(onError: (message: string) => void) {
  const [info, setInfo] = useState<AppWindowInfo>({ maximized: false, version: "" });
  useEffect(() => {
    let disposed = false;
    let frame = 0;
    const refresh = () => {
      void window.xAgent.workspace.getWindowInfo().then((next) => {
        if (!disposed) setInfo(next);
      }).catch(() => {});
    };
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(refresh);
    };
    refresh();
    window.addEventListener("resize", onResize);
    return () => { disposed = true; cancelAnimationFrame(frame); window.removeEventListener("resize", onResize); };
  }, []);
  const control = useCallback(async (action: AppWindowAction) => {
    try { setInfo(await window.xAgent.workspace.controlWindow(action)); }
    catch (error) {
      if (action !== "close") onError(error instanceof Error ? error.message : "窗口操作失败");
    }
  }, [onError]);
  return { ...info, control };
}
