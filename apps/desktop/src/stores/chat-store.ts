/**
 * Renderer chat store — thin re-export of shared/transcript event reducer.
 */
export {
  type ChatItem,
  PENDING_USER_ID_PREFIX,
  createEmptyState,
  makePendingUserId,
  isPendingUserId,
  appendPendingUser,
  removePendingUser,
  applyAgentEvent,
} from "@shared/transcript";
