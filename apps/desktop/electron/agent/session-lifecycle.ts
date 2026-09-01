/**
 * Workspace session lifecycle — open / resume / dispose / createSession.
 * SessionHost composes this module; turn / mode / retract stay on the host.
 */
import { existsSync, renameSync, unlinkSync } from "node:fs";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  getAgentDir,
  type AgentSession,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import {
  SESSION_TOOL_REGISTRY,
  type ClientPrefs,
  type HistoryItem,
  type OpenProjectResult,
  type SessionInfo,
  type ThinkingLevel,
} from "../../shared/ipc";
import {
  DEFAULT_SESSION_TYPE,
  coerceSessionType,
  type SessionType,
} from "../../shared/session-type";
import { computeSessionTypeTools } from "../../shared/session-type-tools";
import { createSessionTypePolicy } from "./session-type-policy";
import { getCachedPrefs, patchPrefs } from "./prefs";
import { branchEntriesToHistory } from "../../shared/transcript";
import { getXAgentSessionsRoot, isXAgentSessionPath } from "./session-paths";
import { displaySessionName } from "./session-title";
import { createGodotTools } from "./godot-tools";
import { dbgLog } from "../../shared/debug-log";
import {
  createDesktopExtensionUi,
  mapExtensionNotifyLevel,
} from "./extension-ui";
import {
  clearGoalJournal,
  clearPlanJournal,
  computeModeToolsForType,
  createWritePlanTools,
  createPlanModeGuardExtension,
} from "./session-mode/index";
import {
  createDesignWriteGuardExtension,
} from "./session-mode/design-write-guard";
import {
  clearSessionType,
  loadSessionType,
  saveSessionType,
} from "./session-type-persistence";
import {
  normalizeProjectKey,
  pickFallbackSessionPath,
  sessionPathsForProject,
} from "../../shared/project-path";
import { applyXAgentSkillsFilter } from "./filter-session-skills";
import { ensureBuiltinDesignSkillsInstalledSafe } from "./builtin-skills-installer";
import {
  failOpen,
  modelFromSession,
} from "./session-host-helpers";
import type { SessionLifecycleHost } from "./host-interfaces";
import { createInitCommandExtension } from "./extensions/init-command";
import { augmentAgentsFiles } from "./agents-md-context";

export type SessionBundle = {
  session: AgentSession;
  unsubscribe: () => void;
  cwd: string;
  sessionPath: string | null;
  /** Session type (locked at creation). Defaults to "code" for legacy. */
  sessionType: SessionType;
};

export class SessionLifecycle {
  constructor(private readonly getHost: () => SessionLifecycleHost) {}

  private a(): SessionLifecycleHost {
    return this.getHost();
  }

  private sessionFileOf(session: AgentSession): string | null {
    const file = (session as { sessionFile?: string | null }).sessionFile;
    return file ?? null;
  }

  private async disposeBundle(bundle: SessionBundle | null): Promise<void> {
    if (!bundle) return;
    try {
      if (bundle.session.isStreaming) {
        await bundle.session.abort();
      }
    } catch {
      // ignore
    }
    try {
      bundle.unsubscribe();
      bundle.session.dispose();
    } catch {
      // ignore
    }
    // Drop tool detail cache so IDs from a prior session cannot leak into the panel.
    this.a().toolDetails.clear();
    this.a().fileTracker.clear();
    this.a().shadowCheckpoints.clear();
    this.a().setAutoTitleInFlight(false);
    this.a().setLastHistoryFingerprint(null);
    // Do NOT clear resourceLoader here — createSession assigns the next loader
    // before disposing the previous bundle; wiping it would break Plan/Goal
    // system-append refresh and setActiveToolsByName via sessionMode.refreshSystemPrompt.
    this.a().sessionMode.reset({ emit: false });
  }

  private clearResourceLoader(): void {
    this.a().setResourceLoader(null);
    this.a().setBaseAppendPrompt([]);
  }

  private async createSession(
    cwd: string,
    sessionManager: SessionManager,
    requestedType: SessionType = DEFAULT_SESSION_TYPE,
  ): Promise<OpenProjectResult> {
    const prefs = getCachedPrefs();
    const modelRuntime = await this.a().ensureRuntime();
    const agentDir = getAgentDir();
    // Mode resets with each new session bundle.
    this.a().sessionMode.reset({ emit: false });
    this.a().setBaseAppendPrompt([]);
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      // Pi auto-loads ~/.agents/skills (Cursor/Claude skills). X-agent only
      // uses ~/.pi/agent/skills + project .pi/skills (+ installed packages).
      // Godot-tier skills (godot-*) are indexed only when cwd has project.godot.
      // User-disabled skills (prefs.disabledSkills) are dropped from the index.
      skillsOverride: (base) => ({
        skills: applyXAgentSkillsFilter(
          base.skills,
          cwd,
          getCachedPrefs().disabledSkills,
          requestedType,
        ),
        diagnostics: base.diagnostics,
      }),
      // Plan/Goal instructions live in system append (not per user message).
      // SessionHost mutates the returned array on mode change, then rebuilds
      // via setActiveToolsByName → getAppendSystemPrompt().
      appendSystemPromptOverride: (base) => {
        this.a().setBaseAppendPrompt([...base]);
        return this.a().sessionMode.composeModeAppend(base);
      },
      // Pi's `loadProjectContextFiles` only walks AGENTS.md / CLAUDE.md per
      // directory. X-agent additionally picks up the single-name variants
      // `AGENT.md` / `agent.md` (and case forms) so small projects / non-
      // Claude-Code conventions still surface their context file. Augment
      // is non-destructive: when a directory already has AGENTS.md (Pi's
      // discovery), the singular file is not double-injected.
      agentsFilesOverride: (base) => augmentAgentsFiles(base, { cwd, agentDir }),
      extensionFactories: [
        createPlanModeGuardExtension({
          getMode: () => this.a().sessionMode.getMode(),
          getAllowedTools: () => {
            const prefsTools = getCachedPrefs().tools;
            const mode = this.a().sessionMode.getMode();
            const policy = createSessionTypePolicy(
              this.a().getBundle()?.sessionType,
            );
            return computeModeToolsForType(policy, mode, prefsTools);
          },
          getCwd: () => this.a().getBundle()?.cwd ?? null,
        }),
        // Design session type: block writes outside <cwd>/game-design/.
        // No-op for code sessions (guard checks sessionType === "design" first).
        createDesignWriteGuardExtension({
          getSessionType: () =>
            this.a().getBundle()?.sessionType ?? DEFAULT_SESSION_TYPE,
          getCwd: () => this.a().getBundle()?.cwd ?? null,
        }),
        // `/init` slash command: bootstrap AGENTS.md for the current project.
        // Body is the markdown imported via `?raw`; handler sends it as a
        // user message so the model runs the procedure. Side-effect free on
        // the host side. See `extensions/init-command.ts` for full design.
        createInitCommandExtension(),
      ],
    });
    await loader.reload();
    this.a().setResourceLoader(loader);

    let selectedModel =
      prefs.provider && prefs.model
        ? modelRuntime.getModel(prefs.provider, prefs.model)
        : undefined;

    if (!selectedModel) {
      // 偏好模型不可用(虚构 id / 旧 prefs 残留) → 退到 Pi 实际可用的真实模型并通知用户。
      // 我们**不**再硬编"deepseek-v4-flash":那是 DEFAULT_PREFS 之前的虚构 id,即使
      // 出现在 available[0] 也不一定是用户真正想用的;优先 Pi 内置 anthropic provider,
      // 其次首条 available[0]。
      const available = await modelRuntime.getAvailable();
      selectedModel =
        available.find((m) => m.provider === "anthropic") ?? available[0];
      if (selectedModel) {
        const usedKey =
          prefs.provider && prefs.model
            ? `${prefs.provider}/${prefs.model}`
            : "未配置";
        this.a().emitReplaceableNotice(
          "model",
          `偏好模型 ${usedKey} 不可用,已切换到 ${selectedModel.provider}/${selectedModel.id}`,
          "warn",
        );
      }
    }

    // Resumed sessions already have thinking_level_change in the file. If we
    // pass thinkingLevel into createAgentSession, Pi sets agent state but skips
    // appending when an entry exists — leaving the file stale. Omit the option
    // so the agent restores the file level, then setThinkingLevel applies prefs
    // and persists the change.
    const hasThinkingEntry = sessionManager
      .getBranch()
      .some((entry) => entry.type === "thinking_level_change");

    const { session, modelFallbackMessage } = await createAgentSession({
      cwd,
      agentDir,
      resourceLoader: loader,
      modelRuntime,
      sessionManager,
      // Pi uses `tools` as both registry allowlist AND initial active set.
      // Register the full toggleable set + write_plan so later prefs / Plan mode
      // can activate via setActiveToolsByName; unknown names are silently ignored
      // and would otherwise drop custom tools from the registry entirely.
      tools: [...SESSION_TOOL_REGISTRY],
      customTools: [
        ...((rpc) => (rpc ? createGodotTools(rpc) : []))(this.a().godotRpc),
        ...createWritePlanTools(
          (path) => {
            this.a().sessionMode.onPlanWritten(path);
          },
          () => this.a().sessionMode.getPlanPath(),
        ),
      ],
      ...(selectedModel ? { model: selectedModel } : {}),
      ...(!hasThinkingEntry ? { thinkingLevel: prefs.thinkingLevel } : {}),
    });
    // Apply「默认 Thinking」to the live session (clamps to model capabilities).
    session.setThinkingLevel(prefs.thinkingLevel);
    const effectiveThinking = session.thinkingLevel as ThinkingLevel;
    if (effectiveThinking !== prefs.thinkingLevel) {
      void patchPrefs({ thinkingLevel: effectiveThinking });
    }
    // Initial active set = session-type derived from prefs (code = prefs.tools;
    // design = readonly core + write/edit, with write/edit path-checked by the
    // design-write-guard extension). Must run after createAgentSession so the
    // registry is built.
    session.setActiveToolsByName(
      computeSessionTypeTools(requestedType, prefs.tools),
    );

    // Wire ExtensionUI.notify → chat system notices (e.g. /godot-rpc-status).
    // Without this, Pi uses noOpUIContext and extension commands appear silent.
    await session.bindExtensions({
      mode: "rpc",
      uiContext: createDesktopExtensionUi((message, type) => {
        this.a().emitReplaceableNotice(
          "extension",
          message,
          mapExtensionNotifyLevel(type),
        );
      }),
    });

    const sessionPath = this.sessionFileOf(session);
    // Persist the type sidecar NOW (after we have sessionPath) so a follow-up
    // resume can recover the type. Failure is non-fatal per plan §3.3.
    if (sessionPath) {
      saveSessionType(sessionPath, requestedType);
    }

    const unsubscribe = this.a().bridgeEvents(session);
    const nextBundle: SessionBundle = {
      session,
      unsubscribe,
      cwd,
      sessionPath,
      sessionType: requestedType,
    };

    const previous = this.a().getBundle();
    this.a().setBundle(nextBundle);
    await this.disposeBundle(previous);
    // Re-bind after disposeBundle — must stay set for Plan/Goal mode switches.
    this.a().setResourceLoader(loader);
    // C11: 把 Godot RPC 路由绑定到当前会话项目，避免会话切换后旧项目
    // 的 Godot 编辑器还能接收/观察本会话的工具调用。
    this.a().godotRpc?.setCurrentCwd(cwd);
    // Fresh in-memory mode; restore pursuing/paused goal from journal if any.
    this.a().sessionMode.emitSessionMode();
    this.a().sessionMode.emitGoal();
    this.a().sessionMode.restoreGoalFromJournal();
    // Restore the plan reference so the right panel shows the plan again
    // after restarting the app (plan files persist on disk).
    this.a().sessionMode.restorePlanFromJournal();

    // sessionPath 已在 bundle 里写入, 上面循环里也用过了. 这里不需要重新声明.
    if (session.model) {
      // 若用户偏好仍是旧的虚构默认("deepseek/deepseek-v4-flash")，把真实生效模型
      // 写回 prefs 并显式通知；否则每次启动都以为已配置，实际却被静默回退。
      const previousWasLegacyDefault =
        prefs.provider === "deepseek" && prefs.model === "deepseek-v4-flash";
      void patchPrefs({
        provider: session.model.provider,
        model: session.model.id,
      });
      if (previousWasLegacyDefault) {
        this.a().emitReplaceableNotice(
          "model",
          `已重置默认模型：旧值 deepseek/deepseek-v4-flash 不可用，已切换到 ${session.model.provider}/${session.model.id}`,
          "warn",
        );
      }
    }
    void patchPrefs({
      lastProjectPath: cwd,
      lastSessionPath: nextBundle.sessionPath,
    });

    this.a().fileTracker.setCwd(cwd);
    this.a().fileTracker.clear();
    this.a().fileTracker.loadFromSession(session.sessionManager);
    await this.a().shadowCheckpoints.setCwd(cwd);
    this.a().shadowCheckpoints.loadFromSession(session.sessionManager);

    const history: HistoryItem[] = branchEntriesToHistory(
      session.sessionManager.getBranch(),
    );

    const info: OpenProjectResult = {
      ok: true,
      cwd,
      sessionId: session.sessionId,
      model: modelFromSession(session),
      thinkingLevel: effectiveThinking,
      sessionType: requestedType,
      ...(modelFallbackMessage ? { warning: modelFallbackMessage } : {}),
    };

    this.a().emit({
      type: "session_info",
      sessionId: session.sessionId,
      cwd,
      model: info.model,
      thinkingLevel: info.thinkingLevel,
      sessionType: requestedType,
      availableThinkingLevels: session.getAvailableThinkingLevels(),
      sessionPath,
    });
    // DEBUG(thinking-switch #30): 标记 openSession 的 session_info
    dbgLog("lifecycle", "session_info (openSession)", {
      sessionId: session.sessionId,
      thinkingLevel: info.thinkingLevel,
      available: session.getAvailableThinkingLevels(),
    });
    this.a().setLastHistoryFingerprint(this.a().historyFingerprint(history));
    this.a().emit({ type: "history_replace", items: history });
    if (modelFallbackMessage) {
      this.a().emitReplaceableNotice("model", modelFallbackMessage, "warn");
    }
    this.a().setLastTurnUsage(undefined);
    this.a().setStatus("idle");
    this.a().emitUsageUpdate();
    return info;
  }

  private unhideProjectKey(cwd: string): void {
    const key = normalizeProjectKey(cwd);
    if (!key) return;
    const prefs = getCachedPrefs();
    const nextHidden = prefs.hiddenProjectKeys.filter(
      (k) => normalizeProjectKey(k) !== key,
    );
    if (nextHidden.length !== prefs.hiddenProjectKeys.length) {
      void patchPrefs({ hiddenProjectKeys: nextHidden });
    }
  }

  async openProject(
    cwd: string,
    mode: "continue" | "new" = "continue",
    sessionType: SessionType = DEFAULT_SESSION_TYPE,
  ): Promise<OpenProjectResult> {
    if (!cwd || !existsSync(cwd)) {
      return failOpen("项目路径不存在", cwd);
    }
    return this.a().runReplaceExclusive(async () => {
      try {
        const root = getXAgentSessionsRoot();
        const sessionManager =
          mode === "new"
            ? SessionManager.create(cwd, root)
            : SessionManager.continueRecent(cwd, root);
        const result = await this.createSession(cwd, sessionManager, sessionType);
        if (result.ok) {
          this.unhideProjectKey(cwd);
          // Fire-and-forget: 兜底 install 5 个 builtin design skill.
          // 启动时已预热, 正常情况 hit 缓存, 不会真做写盘.
          // 失败由 installer 内部静默吞, 不影响 session start 返回.
          void ensureBuiltinDesignSkillsInstalledSafe();
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.a().setStatus("error", message);
        return failOpen(message, this.a().getBundle()?.cwd ?? cwd);
      }
    });
  }

  async newSession(sessionType: SessionType = DEFAULT_SESSION_TYPE): Promise<OpenProjectResult> {
    const cwd = this.a().getBundle()?.cwd;
    if (!cwd) {
      return failOpen("尚未打开项目");
    }
    return this.openProject(cwd, "new", sessionType);
  }

  async resumeSession(sessionPath: string): Promise<OpenProjectResult> {
    return this.a().runReplaceExclusive(async () => {
      try {
        if (!isXAgentSessionPath(sessionPath)) {
          return failOpen("只能恢复本客户端创建的会话（与 Pi CLI 会话已隔离）");
        }
        if (!existsSync(sessionPath)) {
          return failOpen("会话文件不存在");
        }
        const sessionManager = SessionManager.open(
          sessionPath,
          getXAgentSessionsRoot(),
        );
        const cwd = sessionManager.getCwd();
        if (!cwd) {
          return failOpen(
            "无法从会话文件解析项目路径，请先打开对应项目后再恢复",
          );
        }
        // 恢复时从 sidecar 读 type, 缺省 fallback 到 DEFAULT_SESSION_TYPE (向后兼容).
        const sessionType = loadSessionType(sessionPath);
        const result = await this.createSession(cwd, sessionManager, sessionType);
        if (result.ok) this.unhideProjectKey(cwd);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // E7: 会话文件损坏（崩溃半写等）时先备份，避免用户会话静默不可恢复。
        let backedUp = "";
        try {
          if (existsSync(sessionPath)) {
            const stamp = new Date().toISOString().replace(/[:.]/g, "-");
            const backup = `${sessionPath}.broken-${stamp}.bak`;
            renameSync(sessionPath, backup);
            backedUp = backup;
          }
        } catch {
          /* ignore */
        }
        this.a().setStatus("error", message);
        return failOpen(
          backedUp
            ? `会话文件无法解析，已备份到 ${backedUp}`
            : message,
          this.a().getBundle()?.cwd ?? "",
        );
      }
    });
  }

  async deleteSession(sessionPath: string): Promise<{ ok: boolean; error?: string }> {
    return this.a().runReplaceExclusive(async () => {
      if (!isXAgentSessionPath(sessionPath)) {
        return { ok: false, error: "只能删除本客户端会话" };
      }
      if (!existsSync(sessionPath)) {
        return { ok: false, error: "会话文件不存在" };
      }

      const wasActive = this.a().getBundle()?.sessionPath === sessionPath;
      const cwd = wasActive ? this.a().getBundle()!.cwd : null;

      if (wasActive) {
        // Null the bundle before dispose so bridgeSessionEvents ignores abort
        // traffic from the doomed session (getSession() !== session).
        const doomed = this.a().getBundle();
        this.a().setBundle(null);
        await this.disposeBundle(doomed);
        this.clearResourceLoader();
      }

      try {
        unlinkSync(sessionPath);
      } catch (err) {
        // E3: Windows 上会话文件可能被后台进程短暂占用，删除失败不应让 IPC reject。
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `删除会话文件失败：${message}` };
      }
      clearGoalJournal(sessionPath);
      clearPlanJournal(sessionPath);
      clearSessionType(sessionPath);

      const prefs = getCachedPrefs();
      if (prefs.lastSessionPath === sessionPath) {
        void patchPrefs({ lastSessionPath: null });
      }

      if (!wasActive) {
        return { ok: true };
      }

      // Prefer another session in the same project; never silently create a new one.
      const remaining = await this.listSessions();
      const fallbackPath = pickFallbackSessionPath(
        remaining,
        cwd ?? "",
        sessionPath,
      );
      if (fallbackPath) {
        try {
          const sessionManager = SessionManager.open(
            fallbackPath,
            getXAgentSessionsRoot(),
          );
          const fallbackCwd = sessionManager.getCwd() || cwd;
          if (!fallbackCwd) {
            await this.emitClosedWorkspace();
            return { ok: true };
          }
          await this.createSession(fallbackCwd, sessionManager);
          return { ok: true };
        } catch {
          await this.emitClosedWorkspace(cwd);
          return { ok: true };
        }
      }

      await this.emitClosedWorkspace(cwd);
      return { ok: true };
    });
  }

  /** Delete all X-agent sessions belonging to a project cwd. */
  async deleteProjectSessions(
    projectCwd: string,
  ): Promise<{ ok: boolean; deleted?: number; error?: string }> {
    return this.a().runReplaceExclusive(async () => {
      const key = normalizeProjectKey(projectCwd);
      const listed = await this.listSessions();
      const paths = sessionPathsForProject(listed, projectCwd);
      if (paths.length === 0) {
        return { ok: true, deleted: 0 };
      }

      const activePath = this.a().getBundle()?.sessionPath ?? null;
      const activeCwd = this.a().getBundle()?.cwd ?? null;
      const activeInProject =
        Boolean(this.a().getBundle()) &&
        (activePath
          ? paths.includes(activePath)
          : normalizeProjectKey(activeCwd ?? "") === key);

      if (activeInProject) {
        const doomed = this.a().getBundle();
        this.a().setBundle(null);
        await this.disposeBundle(doomed);
        this.clearResourceLoader();
      }

      let deleted = 0;
      const prefs = getCachedPrefs();
      let clearLastSession = false;
      for (const sessionPath of paths) {
        if (!isXAgentSessionPath(sessionPath)) continue;
        if (!existsSync(sessionPath)) continue;
        unlinkSync(sessionPath);
        clearGoalJournal(sessionPath);
        clearPlanJournal(sessionPath);
        clearSessionType(sessionPath);
        deleted += 1;
        if (prefs.lastSessionPath === sessionPath) {
          clearLastSession = true;
        }
      }

      if (clearLastSession) {
        void patchPrefs({ lastSessionPath: null });
      }

      if (activeInProject) {
        await this.emitClosedWorkspace(activeCwd ?? projectCwd);
      }

      return { ok: true, deleted };
    });
  }

  /** Close current workspace without deleting session files (sidebar hide). */
  async closeWorkspace(): Promise<{ ok: boolean; error?: string }> {
    return this.a().runReplaceExclusive(async () => {
      const cwd = this.a().getBundle()?.cwd ?? null;
      const doomed = this.a().getBundle();
      this.a().setBundle(null);
      await this.disposeBundle(doomed);
      this.clearResourceLoader();
      this.a().setLastTurnUsage(undefined);
      this.a().clearCompactionState();
      await this.emitClosedWorkspace(cwd);
      return { ok: true };
    });
  }

  async emitClosedWorkspace(cwd?: string | null): Promise<void> {
    const prefs = getCachedPrefs();
    const patch: Partial<ClientPrefs> = { lastSessionPath: null };
    if (cwd && normalizeProjectKey(prefs.lastProjectPath ?? "") === normalizeProjectKey(cwd)) {
      patch.lastProjectPath = null;
    }
    void patchPrefs(patch);
    this.a().setLastHistoryFingerprint(this.a().historyFingerprint([]));
    this.a().emit({ type: "history_replace", items: [] });
    // DEBUG(thinking-switch #30): 标记 closeWorkspace 的 session_info
    dbgLog("lifecycle", "session_info (closeWorkspace)", {
      thinkingLevel: getCachedPrefs().thinkingLevel,
    });
    this.a().emit({
      type: "session_info",
      sessionId: "",
      cwd: "",
      model: null,
      thinkingLevel: getCachedPrefs().thinkingLevel,
      // close 时没有 bundle 上下文, renderer 拿到 undefined 时回退到全部 THINKING_LEVELS
      availableThinkingLevels: [],
      sessionPath: null,
    });
    this.a().setStatus("idle");
    // C11: 关闭项目后解除 Godot RPC cwd 绑定，避免下一次会话被上次的项目拦截。
    this.a().godotRpc?.setCurrentCwd(null);
  }

  async renameSession(
    sessionPath: string,
    name: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return this.a().runReplaceExclusive(async () => {
      const trimmed = name.trim();
      if (!trimmed) return { ok: false, error: "名称不能为空" };
      if (!isXAgentSessionPath(sessionPath)) {
        return { ok: false, error: "只能重命名本客户端会话" };
      }
      try {
        const active = this.a().getBundle();
        if (active?.sessionPath === sessionPath) {
          active.session.setSessionName(trimmed);
          return { ok: true };
        }
        const sm = SessionManager.open(sessionPath, getXAgentSessionsRoot());
        sm.appendSessionInfo(trimmed);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
  }

  async listSessions(): Promise<SessionInfo[]> {
    try {
      const all = await SessionManager.listAll(getXAgentSessionsRoot());
      return all
        .slice()
        .sort((a, b) => {
          const at = new Date(a.modified ?? a.created ?? 0).getTime();
          const bt = new Date(b.modified ?? b.created ?? 0).getTime();
          return bt - at;
        })
        .slice(0, 100)
        .map((s) => ({
          id: s.id,
          name: displaySessionName(s.name, s.firstMessage),
          path: s.path,
          cwd: s.cwd ?? "",
          updatedAt: new Date(s.modified ?? s.created ?? Date.now()).toISOString(),
          // sessionType 从 sidecar 读; 缺省 fallback 到 DEFAULT_SESSION_TYPE.
          sessionType: coerceSessionType(loadSessionType(s.path)),
        }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.a().emitReplaceableNotice(
        "session",
        `列出会话失败: ${message}`,
        "warn",
      );
      return [];
    }
  }

  async dispose(): Promise<void> {
    return this.a().runReplaceExclusive(async () => {
      const doomed = this.a().getBundle();
      this.a().setBundle(null);
      await this.disposeBundle(doomed);
      this.clearResourceLoader();
      this.a().setLastTurnUsage(undefined);
      this.a().clearCompactionState();
    });
  }

}
