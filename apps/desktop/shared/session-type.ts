/**
 * Session type — a session-level (immutable for the session's lifetime) abstraction
 * orthogonal to the existing 4 AgentSessionMode (agent / ask / plan / goal).
 *
 * Two values:
 * - "code"   : default; the legacy behavior. Has full prefs.tools, can mutate any
 *              project file. Modes are interchangeable.
 * - "design" : a planning-only session. Reads any project file, but write/edit
 *              tools are constrained to <cwd>/game-design/. Internal mode cycling
 *              still works; the write constraint is always active.
 *
 * The type is locked at session creation; there is no IPC to change it. Old
 * sessions without a persisted type fall back to "code".
 */
export const SESSION_TYPES = ["code", "design"] as const;

export type SessionType = (typeof SESSION_TYPES)[number];

/** Display labels (zh-CN; i18n is out of scope per plan §5.3). */
export const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  code: "代码",
  design: "策划",
};

/** Default for legacy sessions and omitted newSession() arg. */
export const DEFAULT_SESSION_TYPE: SessionType = "code";

export function isSessionType(v: unknown): v is SessionType {
  return (
    typeof v === "string" && (SESSION_TYPES as readonly string[]).includes(v)
  );
}

/** Coerce unknown input into a valid SessionType, defaulting to DEFAULT_SESSION_TYPE. */
export function coerceSessionType(v: unknown): SessionType {
  return isSessionType(v) ? v : DEFAULT_SESSION_TYPE;
}
