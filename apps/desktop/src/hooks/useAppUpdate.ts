import { useCallback, useState } from "react";
import type { AppUpdateStatus } from "@shared/ipc";
import {
  shouldShowUpdateBanner,
  updateVersionKey,
} from "@shared/update-ui";
import { useUpdateStatus } from "./useUpdateStatus";

type UseAppUpdateOptions = {
  /** When false, skip status subscription (e.g. settings page closed). Default true. */
  enabled?: boolean;
  onError?: (message: string) => void;
};

/**
 * Packaged-app update UX: status, banner visibility, download/install/dismiss.
 */
export function useAppUpdate(options: UseAppUpdateOptions = {}) {
  const { enabled = true, onError } = options;
  const status = useUpdateStatus({ enabled });
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const showBanner = shouldShowUpdateBanner(status, dismissedVersion);
  const versionKey = updateVersionKey(status);

  const dismiss = useCallback(() => {
    setDismissedVersion(versionKey);
  }, [versionKey]);

  const reopen = useCallback(() => {
    setDismissedVersion(null);
  }, []);

  const downloadOrInstall = useCallback(async () => {
    if (!status?.supported || busy) return;
    setBusy(true);
    setDismissedVersion(null);
    try {
      if (status.downloaded) {
        const result = await window.xAgent.updates.install();
        if (!result.ok) {
          onError?.(result.error ?? "安装更新失败");
        }
        return;
      }
      if (!status.available) return;
      const next = await window.xAgent.updates.download();
      if (next.error) {
        onError?.(next.error);
        return;
      }
      if (next.downloaded) {
        const result = await window.xAgent.updates.install();
        if (!result.ok) {
          onError?.(result.error ?? "安装更新失败");
        }
      }
    } finally {
      setBusy(false);
    }
  }, [busy, onError, status]);

  const check = useCallback(async (): Promise<AppUpdateStatus | null> => {
    if (busy) return status;
    setBusy(true);
    try {
      return await window.xAgent.updates.check();
    } finally {
      setBusy(false);
    }
  }, [busy, status]);

  const download = useCallback(async (): Promise<AppUpdateStatus | null> => {
    if (busy) return status;
    setBusy(true);
    try {
      return await window.xAgent.updates.download();
    } finally {
      setBusy(false);
    }
  }, [busy, status]);

  const install = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (busy) return { ok: false, error: "busy" };
    setBusy(true);
    try {
      return await window.xAgent.updates.install();
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const onTopBarUpdateClick = useCallback(() => {
    if (showBanner) {
      void downloadOrInstall();
      return;
    }
    reopen();
  }, [downloadOrInstall, reopen, showBanner]);

  return {
    status,
    busy,
    showBanner,
    versionKey,
    dismiss,
    reopen,
    downloadOrInstall,
    check,
    download,
    install,
    onTopBarUpdateClick,
  };
}
