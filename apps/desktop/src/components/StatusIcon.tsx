import type { AgentStatus } from "@shared/ipc";

interface Props {
  status: AgentStatus;
  className?: string;
}

export function StatusIcon({ status, className = "" }: Props) {
  const mapped =
    status === "streaming" || status === "retrying"
      ? "streaming"
      : status === "error"
        ? "error"
        : "idle";

  return (
    <span
      className={`status-icon-dot status-${mapped} ${className}`.trim()}
      aria-hidden
    />
  );
}
