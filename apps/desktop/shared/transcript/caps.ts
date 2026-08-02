/** Caps: restore/history vs live stream tool previews vs tool-detail pane. */
export const TRANSCRIPT_CAPS = {
  /** Default string / JSON truncate for history restore. */
  default: 8000,
  /** Tool args embedded in restored HistoryItem. */
  toolArgs: 4000,
  /** Live stream tool args / partial results. */
  streamTool: 2000,
  /** Live stream tool end result. */
  streamToolResult: 4000,
  /** Tools tab detail store (main process only). */
  toolDetail: 256 * 1024,
} as const;
