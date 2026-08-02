import type { AppUpdateStatus } from "./ipc";

export function updateVersionKey(status: AppUpdateStatus | null): string {
  return status?.version?.trim() || "__available__";
}

export function shouldShowUpdateBanner(
  status: AppUpdateStatus | null,
  dismissedVersion: string | null,
): boolean {
  const available = Boolean(status?.supported) && Boolean(status?.available);
  if (!available || !status) return false;
  return (
    status.downloading ||
    status.downloaded ||
    dismissedVersion !== updateVersionKey(status)
  );
}
