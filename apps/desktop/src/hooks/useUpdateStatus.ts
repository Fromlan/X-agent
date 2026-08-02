import { useEffect, useState } from "react";
import type { AppUpdateStatus } from "@shared/ipc";

type Options = {
  /** When false, do not subscribe (default true). */
  enabled?: boolean;
};

/** Subscribe to packaged-app update status for TopBar / banners / settings. */
export function useUpdateStatus(options: Options = {}): AppUpdateStatus | null {
  const { enabled = true } = options;
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void window.xAgent.updates.getStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });
    const off = window.xAgent.updates.onStatus((s) => {
      setStatus(s);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [enabled]);

  return status;
}
