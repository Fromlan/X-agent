/** Verify visible idle/Goal continuation cannot race past checkpoint persistence or a session replacement. */
import { expect, it, vi } from "vitest";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { bridgeSessionEvents, type SessionEventBridgeDeps } from "./session-event-bridge";

/** Build the real bridge around a controllable checkpoint barrier. */
function fixture() {
  let listener!: (event: { type: "agent_end" }) => void;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const session = { subscribe: (fn: typeof listener) => { listener = fn; return () => {}; } } as unknown as AgentSession;
  let current: AgentSession | null = session;
  const deps: SessionEventBridgeDeps = {
    emit: vi.fn(), setStatus: vi.fn(), setLastErrorSilently: vi.fn(), emitUsageUpdate: vi.fn(), emitHistoryReplace: vi.fn(),
    messageIdFrom: () => "id", toolDetails: new Map(), getSession: () => current,
    turn: { fileTracker: {} as never, shadowCheckpoints: { flush: () => barrier } as never, currentUserEntryId: () => undefined },
    usage: {} as never, maybeAutoTitleSession: vi.fn(async () => {}), autoMaintainIfNeeded: vi.fn(), onAgentSettled: vi.fn(),
  };
  bridgeSessionEvents(session, deps);
  return { deps, finish: () => listener({ type: "agent_end" }), release, replace: () => { current = null; } };
}

it("publishes idle and evaluates goals only after the final checkpoint is committed", async () => {
  const f = fixture(); f.finish();
  expect(f.deps.setStatus).not.toHaveBeenCalled(); expect(f.deps.onAgentSettled).not.toHaveBeenCalled();
  f.release(); await vi.waitFor(() => expect(f.deps.setStatus).toHaveBeenCalledWith("idle"));
  expect(f.deps.onAgentSettled).toHaveBeenCalledTimes(1);
});
it("drops a delayed settle callback after its session was replaced", async () => {
  const f = fixture(); f.finish(); f.replace(); f.release();
  await Promise.resolve(); await Promise.resolve();
  expect(f.deps.setStatus).not.toHaveBeenCalled(); expect(f.deps.onAgentSettled).not.toHaveBeenCalled();
});
