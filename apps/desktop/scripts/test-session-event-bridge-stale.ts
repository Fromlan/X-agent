/**
 * Stale-session guard: after the host switches bundles, events from the
 * previous AgentSession must not reach the UI (delete → new chat leak).
 */
import assert from "node:assert/strict";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  bridgeSessionEvents,
  type SessionEventBridgeDeps,
} from "../electron/agent/session-event-bridge";
import type { UiAgentEvent } from "../shared/ipc";
import { TurnFileTracker } from "../electron/agent/turn-file-tracker";
import { ShadowCheckpointTracker } from "../electron/agent/shadow-checkpoints";

type Listener = (event: { type: string; [k: string]: unknown }) => void;

function mockSession(label: string): AgentSession & { _listeners: Set<Listener> } {
  const listeners = new Set<Listener>();
  return {
    _listeners: listeners,
    sessionId: label,
    subscribe(fn: Listener) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  } as unknown as AgentSession & { _listeners: Set<Listener> };
}

function baseDeps(
  getSession: () => AgentSession | null,
  emitted: UiAgentEvent[],
): SessionEventBridgeDeps {
  const fileTracker = new TurnFileTracker();
  const shadowCheckpoints = new ShadowCheckpointTracker();
  return {
    emit: (event) => {
      emitted.push(event);
    },
    setStatus: () => {},
    setLastErrorSilently: () => {},
    emitUsageUpdate: () => {},
    emitHistoryReplace: () => {},
    messageIdFrom: () => "msg-1",
    toolDetails: new Map(),
    getSession,
    turn: {
      fileTracker,
      shadowCheckpoints,
      currentUserEntryId: () => undefined,
    },
    usage: {
      setLastTurnUsage: () => {},
      isCompactionRecording: () => false,
      setCompactionRecording: () => {},
      captureCompactionBaseline: () => {},
      recordCompactionDelta: () => {},
      clearCompactionBaseline: () => {},
    },
    maybeAutoTitleSession: async () => {},
  };
}

const oldSession = mockSession("old");
const newSession = mockSession("new");
let active: AgentSession | null = oldSession;
const emitted: UiAgentEvent[] = [];

const unsub = bridgeSessionEvents(
  oldSession,
  baseDeps(() => active, emitted),
);

// Live session: user_message must forward.
for (const fn of oldSession._listeners) {
  fn({
    type: "message_start",
    message: {
      role: "user",
      content: [{ type: "text", text: "/" }],
    },
  });
}
assert.equal(emitted.length, 1, "live session forwards user_message");
assert.equal(emitted[0]!.type, "user_message");
assert.equal(
  (emitted[0] as { type: "user_message"; text: string }).text,
  "/",
  "forwarded text",
);

// Host switched bundles (newSession / delete+create) before old abort finishes.
active = newSession;
emitted.length = 0;
for (const fn of oldSession._listeners) {
  fn({
    type: "message_start",
    message: {
      role: "user",
      content: [{ type: "text", text: "/" }],
    },
  });
}
assert.equal(
  emitted.length,
  0,
  "stale session must not emit user_message after bundle switch",
);

unsub();
console.log("test-session-event-bridge-stale: ok");
