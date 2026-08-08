import { useEffect, useRef } from "react";
import type { SessionUsageSnapshot } from "@shared/ipc";

/**
 * When occupancy reaches `thresholdPercent` (1–100), compact once per crossing.
 * Resets after percent drops below threshold − 5 so a later spike can fire again.
 */
export function useAutoCompact(options: {
  thresholdPercent: number;
  usage: SessionUsageSnapshot | null;
  busy: boolean;
  compacting: boolean;
  sessionId: string | null;
}): void {
  const { thresholdPercent, usage, busy, compacting, sessionId } = options;
  const firedForSession = useRef<string | null>(null);

  useEffect(() => {
    firedForSession.current = null;
  }, [sessionId]);

  useEffect(() => {
    if (thresholdPercent <= 0 || thresholdPercent > 100) return;
    if (!sessionId || busy || compacting) return;
    const percent = usage?.context?.percent;
    if (percent == null) return;

    if (percent < Math.max(1, thresholdPercent - 5)) {
      if (firedForSession.current === sessionId) {
        firedForSession.current = null;
      }
      return;
    }

    if (percent < thresholdPercent) return;
    if (firedForSession.current === sessionId) return;

    firedForSession.current = sessionId;
    void window.xAgent.session.compactSession()
      .then((result) => {
        if (!result.ok) {
          // Allow retry on next usage tick after a brief cooldown via reset below.
          firedForSession.current = null;
        }
      })
      .catch(() => {
        // D10: IPC 异常（如会话已关闭）时允许下次重试。
        firedForSession.current = null;
      });
  }, [thresholdPercent, usage, busy, compacting, sessionId]);
}
