/**
 * 对话实录保真 — single seam for Pi branch / stream → HistoryItem[].
 */
export { TRANSCRIPT_CAPS } from "./caps";
export { truncateSerialized, truncateTranscript } from "./truncate";
export {
  textFromContent,
  thinkingFromContent,
  extractMessageText,
} from "./content";
export type { TranscriptContentPart } from "./content";
export {
  messagesToHistory,
  branchEntriesToHistory,
} from "./branch-mapper";
export type { TranscriptMessage, BranchMessageEntry } from "./branch-mapper";
export {
  type ChatItem,
  PENDING_USER_ID_PREFIX,
  createEmptyState,
  makePendingUserId,
  isPendingUserId,
  appendPendingUser,
  removePendingUser,
  applyAgentEvent,
} from "./apply-events";
export { isDisplayableTranscriptItem } from "./display";
export { formatErrorBubble } from "./error-format";
