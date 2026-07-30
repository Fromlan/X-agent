import { useEffect, useState } from "react";
import type { AppUpdateStatus } from "@shared/ipc";

/** Subscribe to packaged-app update status for TopBar / banners. */
export function useUpdateStatus(): AppUpdateStatus | null {
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.xAgent.getUpdateStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });
    const off = window.xAgent.onUpdateStatus((s) => {
      setStatus(s);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return status;
}
