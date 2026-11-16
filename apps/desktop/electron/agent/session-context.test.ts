/** Exercise application context snapshots against real Pi sessions without credentials or model calls. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { getCurrentTools, getToolStateChanges, toToolDeclaration } from "@earendil-works/pi-ai";
import { buildUsageSnapshot } from "./session-usage";
import { autoMaintain } from "./auto-maintain";
import { DEFAULT_PREFS } from "../../shared/ipc";
import { estimateMessageTokens } from "./session-host-helpers";

describe("context accounting with Pi SDK", () => {
  let directory: string;
  const sessions: AgentSession[] = [];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "x-agent-context-"));
    vi.stubEnv("PI_OFFLINE", "1");
  });

  afterEach(() => {
    for (const session of sessions.splice(0)) session.dispose();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  /** Use explicit isolated stores and disable every discovery surface unrelated to context accounting. */
  async function open(manager = SessionManager.inMemory(directory)): Promise<AgentSession> {
    const runtime = await ModelRuntime.create({
      authPath: join(directory, "auth.json"), modelsPath: join(directory, "models.json"),
      allowModelNetwork: false, refreshOnCreate: false,
    });
    runtime.registerProvider("context-fixture", {
      api: "openai-completions", baseUrl: "https://offline.example", apiKey: "fixture",
      models: [{ id: "fixture", name: "Context fixture", reasoning: false, input: ["text"],
        contextWindow: 200_000, maxTokens: 1_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    });
    const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } });
    const resourceLoader = new DefaultResourceLoader({
      cwd: directory, agentDir: directory, settingsManager,
      noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
      systemPrompt: "Context fixture", appendSystemPrompt: [],
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd: directory, agentDir: directory, modelRuntime: runtime, resourceLoader, settingsManager,
      model: runtime.getModel("context-fixture", "fixture"), sessionManager: manager, tools: ["read"], thinkingLevel: "off",
    });
    session.setActiveToolsByName([]);
    sessions.push(session);
    return session;
  }

  /** Persist a provider-normalized request result, including all three input buckets. */
  function appendResponse(session: AgentSession, input = 10_000, cacheRead = 80_000, cacheWrite = 40_000): void {
    const changes = getToolStateChanges(getCurrentTools(session.sessionManager.buildSessionProjection().messages), session.agent.state.tools);
    // Real SDK requests commit the declared tool delta before the assistant response.
    if (changes.toolsAdded.length || changes.toolsRemoved.length) {
      session.sessionManager.appendMessage({ role: "system", content: "", ...changes, timestamp: 0 });
    }
    session.sessionManager.appendMessage({
      role: "assistant", content: [{ type: "text", text: "x".repeat(20_000) }],
      api: "openai-completions", provider: "context-fixture", model: "fixture", stopReason: "stop", timestamp: 1,
      usage: { input, cacheRead, cacheWrite, output: 5_000, totalTokens: input + cacheRead + cacheWrite + 5_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    });
    session.refreshContext();
  }

  it("restores current context and latest request from a real session file", async () => {
    const original = await open(SessionManager.create(directory, join(directory, "sessions")));
    original.sessionManager.appendMessage({ role: "user", content: "ask", timestamp: 0 });
    appendResponse(original);
    const restored = await open(SessionManager.open(original.sessionFile!));
    expect(restored.getContextUsage()?.tokens).toBe(135_000);
    const snapshot = buildUsageSnapshot(restored);
    expect(snapshot?.context?.tokens).toBe(135_000);
    expect(snapshot?.lastTurn?.tokens.cacheWrite).toBe(40_000);
  });

  it("uses the navigated branch while preserving the session's billed totals", async () => {
    const session = await open();
    const user = session.sessionManager.appendMessage({ role: "user", content: "ask", timestamp: 0 });
    appendResponse(session);
    await session.navigateTree(user, { summarize: false });
    const snapshot = buildUsageSnapshot(session);
    expect(snapshot?.context?.source).toBe("estimate");
    expect(snapshot?.context?.tokens).toBeLessThan(1_000);
    expect(snapshot?.lastTurn).toBeUndefined();
    expect(snapshot?.tokens.total).toBe(135_000);
  });

  it("invalidates retained pre-summary usage and estimates the compacted projection", async () => {
    const session = await open();
    const user = session.sessionManager.appendMessage({ role: "user", content: "ask", timestamp: 0 });
    appendResponse(session);
    session.sessionManager.appendCompaction("Summary", user, 135_000);
    session.refreshContext();
    expect(session.getContextUsage()?.tokens).toBeNull();
    const snapshot = buildUsageSnapshot(session);
    expect(snapshot?.lastTurn).toBeUndefined();
    expect(snapshot?.context?.tokens).toBeGreaterThan(0);
    expect(snapshot?.context?.tokens).toBeLessThan(10_000);
  });

  it("persists tool-result pruning and skips a summary once the real projection fits", async () => {
    const session = await open(SessionManager.create(directory, join(directory, "sessions")));
    session.sessionManager.appendMessage({ role: "user", content: "ask", timestamp: 0 });
    session.sessionManager.appendMessage({
      role: "toolResult", toolName: "read", toolCallId: "read-1", isError: false,
      content: [{ type: "text", text: "x".repeat(600_000) }], timestamp: 1,
    });
    appendResponse(session, 185_000, 0, 0);
    const compact = vi.spyOn(session, "compact").mockRejectedValue(new Error("Summary must not be requested"));
    const report = await autoMaintain(session, {
      ...DEFAULT_PREFS, autoCompactPercent: 80, autoSnipThreshold: 8192, autoSnipHeadKeep: 4096, autoSnipTailKeep: 1024,
    }, { now: () => 100_000 });
    expect(report.outcome).toBe("snip-cleared");
    expect(compact).not.toHaveBeenCalled();
    expect(session.getContextUsage()?.tokens).toBeLessThan(15_000);
    const restored = await open(SessionManager.open(session.sessionFile!));
    const tool = restored.messages.find((message) => message.role === "toolResult");
    expect(JSON.stringify(tool)).toContain("tool result middle pruned");
    expect(JSON.stringify(tool).length).toBeLessThan(6_000);
    expect(buildUsageSnapshot(restored)?.context?.tokens).toBeLessThan(15_000);
    expect(restored.sessionManager.getBranch().some((entry) => entry.type === "context_edit")).toBe(true);
  });

  it("does not count structured system sections as conversation messages", async () => {
    const session = await open();
    session.sessionManager.appendMessage({ role: "system", content: "", sections: { preamble: "s".repeat(4_000) }, timestamp: 0 });
    session.sessionManager.appendMessage({ role: "user", content: "abcd", timestamp: 1 });
    session.refreshContext();
    expect(estimateMessageTokens(session)).toBe(1);
  });

  it("counts trailing tool and user messages once after a measured response", async () => {
    const session = await open();
    appendResponse(session);
    session.sessionManager.appendMessage({ role: "toolResult", toolName: "read", toolCallId: "t", isError: false,
      content: [{ type: "text", text: "abcd" }], timestamp: 2 });
    session.sessionManager.appendMessage({ role: "user", content: "abcdefgh", timestamp: 3 });
    session.refreshContext();
    expect(buildUsageSnapshot(session)?.context?.tokens).toBe(135_003);
  });

  it("drops the old usage anchor when tools change and accepts a later real response", async () => {
    const session = await open();
    appendResponse(session);
    expect(buildUsageSnapshot(session)?.context?.source).toBe("usage");
    session.setActiveToolsByName(["read"]);
    expect(buildUsageSnapshot(session)?.context?.source).toBe("estimate");
    expect(buildUsageSnapshot(session)?.lastTurn).toBeUndefined();
    appendResponse(session, 1_000, 0, 0);
    expect(buildUsageSnapshot(session)?.context?.tokens).toBe(6_000);
    expect(buildUsageSnapshot(session)?.lastTurn?.tokens.input).toBe(1_000);
  });

  it("rejects an old tool loadout even before the first application snapshot", async () => {
    const session = await open();
    appendResponse(session);
    session.setActiveToolsByName(["read"]);
    expect(buildUsageSnapshot(session)?.context?.source).toBe("estimate");
    expect(buildUsageSnapshot(session)?.lastTurn).toBeUndefined();
    appendResponse(session, 1_000, 0, 0);
    expect(buildUsageSnapshot(session)?.context?.source).toBe("usage");
    expect(buildUsageSnapshot(session)?.context?.tokens).toBe(6_000);
    expect(buildUsageSnapshot(session)?.lastTurn?.tokens.input).toBe(1_000);
  });

  it("compares the measured request's tools instead of a later pending transcript update", async () => {
    const session = await open();
    appendResponse(session);
    session.setActiveToolsByName(["read"]);
    session.sessionManager.appendMessage({ role: "system", content: "",
      toolsAdded: session.agent.state.tools.map(toToolDeclaration), timestamp: 2 });
    session.refreshContext();
    expect(buildUsageSnapshot(session)?.context?.source).toBe("estimate");
    appendResponse(session, 1_000, 0, 0);
    expect(buildUsageSnapshot(session)?.context?.source).toBe("usage");
  });

  it("detects tool removal before the first snapshot and accepts the next measured request", async () => {
    const session = await open();
    session.setActiveToolsByName(["read"]);
    appendResponse(session);
    session.setActiveToolsByName([]);
    expect(buildUsageSnapshot(session)?.context?.source).toBe("estimate");
    appendResponse(session, 1_000, 0, 0);
    expect(buildUsageSnapshot(session)?.context?.source).toBe("usage");
  });

  it("detects same-name tool declaration changes before the first snapshot", async () => {
    const session = await open();
    session.setActiveToolsByName(["read"]);
    appendResponse(session);
    session.agent.state.tools = session.agent.state.tools.map((tool) => ({ ...tool, description: `${tool.description} Updated contract.` }));
    expect(buildUsageSnapshot(session)?.context?.source).toBe("estimate");
    appendResponse(session, 1_000, 0, 0);
    expect(buildUsageSnapshot(session)?.context?.source).toBe("usage");
  });

  it("keeps unknown model capacity distinct from an empty known context", async () => {
    const session = await open();
    session.agent.state.model = undefined;
    expect(await autoMaintain(session, DEFAULT_PREFS)).toMatchObject({ outcome: "no-context-info", percentBefore: null });
  });

  it("does not maintain when disabled, below threshold, or during a running compaction", async () => {
    const session = await open();
    appendResponse(session, 20_000, 0, 0);
    expect(await autoMaintain(session, { ...DEFAULT_PREFS, autoCompactPercent: 0 })).toMatchObject({ outcome: "disabled" });
    expect(await autoMaintain(session, DEFAULT_PREFS)).toMatchObject({ outcome: "below-threshold" });
    vi.spyOn(session, "isCompacting", "get").mockReturnValue(true);
    expect(await autoMaintain(session, DEFAULT_PREFS)).toMatchObject({ outcome: "session-busy" });
  });

  it("summarizes only when the refreshed projection still exceeds the maintenance threshold", async () => {
    const session = await open();
    session.sessionManager.appendMessage({ role: "user", content: "x".repeat(700_000), timestamp: 0 });
    session.sessionManager.appendMessage({ role: "toolResult", toolName: "read", toolCallId: "t", isError: false,
      content: [{ type: "text", text: "x".repeat(40_000) }], timestamp: 1 });
    appendResponse(session, 185_000, 0, 0);
    const compact = vi.spyOn(session, "compact").mockResolvedValue({ summary: "Summary", firstKeptEntryId: "kept", tokensBefore: 190_000, estimatedTokensAfter: 10_000 });
    expect(await autoMaintain(session, DEFAULT_PREFS, { now: () => 100_000 })).toMatchObject({ outcome: "snipped-and-compacted" });
    expect(compact).toHaveBeenCalledOnce();
  });

  it("debounces repeated maintenance and reports summary failures without changing billed usage", async () => {
    const session = await open();
    appendResponse(session, 185_000, 0, 0);
    const compact = vi.spyOn(session, "compact").mockRejectedValue(new Error("offline summary failure"));
    expect(await autoMaintain(session, DEFAULT_PREFS, { now: () => 100_000 })).toMatchObject({ outcome: "compact-failed", detail: "offline summary failure" });
    expect(await autoMaintain(session, DEFAULT_PREFS, { now: () => 101_000 })).toMatchObject({ outcome: "debounced" });
    await autoMaintain(session, DEFAULT_PREFS, { now: () => 110_000 });
    expect(compact).toHaveBeenCalledTimes(2);
    expect(session.getSessionStats().tokens.total).toBe(190_000);
  });
});
