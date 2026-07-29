/**
 * Session branch → HistoryItem. Implementation lives in transcript-mapper
 * (Chat Transcript Fidelity seam).
 */

export type { BranchMessageEntry } from "./transcript-mapper";
export {
  branchEntriesToHistory,
  messagesToHistory,
} from "./transcript-mapper";
