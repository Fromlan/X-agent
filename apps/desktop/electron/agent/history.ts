/**
 * Session branch → HistoryItem. Implementation lives in shared/transcript
 * (Chat Transcript Fidelity seam).
 */

export type { BranchMessageEntry } from "../../shared/transcript";
export {
  branchEntriesToHistory,
  messagesToHistory,
} from "../../shared/transcript";
