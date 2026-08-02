/**
 * Re-export Chat Transcript Fidelity helpers from shared/transcript.
 * Prefer importing from `../../shared/transcript` (or `@shared/transcript`) directly.
 */
export {
  TRANSCRIPT_CAPS,
  truncateTranscript,
  truncateSerialized,
  textFromContent,
  thinkingFromContent,
  extractMessageText,
  messagesToHistory,
  branchEntriesToHistory,
} from "../../shared/transcript";
export type {
  TranscriptMessage,
  BranchMessageEntry,
} from "../../shared/transcript";
