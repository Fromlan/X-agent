/**
 * `AppMainRow` —— Issue #61 主题 F C-201 (2026-08-31).
 *
 * 把 App.tsx 内的 main-row (Sidebar / ChatPanel / RightPanel) 抽成
 * 独立组件。Props 分两组: state (renderer-side) + actions (事件回调),
 * 减少 60+ 个独立 prop。
 */
import type {
  AgentSessionMode,
  AgentStatus,
  ClientPrefs,
  GoalInfo,
  ImageContent,
  ModelInfo,
  SessionInfo,
  ThinkingLevel,
  SessionUsageSnapshot,
} from "@shared/ipc";
import { THINKING_LEVELS } from "@shared/ipc";
import type { SessionType } from "@shared/session-type";
import { Sidebar } from "./Sidebar";
import { ChatPanel } from "./ChatPanel";
import { RightPanel } from "./RightPanel";
import type { ChatItem } from "../stores/chat-store";
import type { ComposerApiStatus } from "../hooks/useComposer";
import { allGodotEditorToolsEnabled } from "../lib/ready-checklist";
import { startersForProject, type ChatStarter } from "../lib/chat-starters";
import { modelSupportsImage } from "../lib/model-capability";
import { useAppLayout } from "../hooks/useAppLayout";
import { useMemo, type CSSProperties, type RefObject } from "react";
import type { FileReference } from "../lib/file-attachment";

export type AppMainRowSidebarActions = {
  onResume: (path: string) => Promise<void>;
  onDelete: (path: string) => Promise<void>;
  onDeleteProjectSessions: (projectCwd: string) => Promise<void>;
  onHideProject: (projectCwd: string) => Promise<void>;
  onRename: (path: string, name: string) => Promise<void>;
  onRefresh: () => Promise<void>;
};

export type AppMainRowChatActions = {
  setInput: (v: string | ((prev: string) => string)) => void;
  onSend: () => Promise<boolean>;
  onAbort: () => Promise<void>;
  onAddFiles: (files: File[]) => Promise<void>;
  onRemoveImage: (index: number) => void;
  onRemoveFile: (index: number) => void;
  onPickStarter: (prompt: string) => void;
  onOpenToolInPanel: (toolId: string, args: unknown) => void;
  onEditDraftChange: (s: string) => void;
  onStartEdit: (id: string, text: string) => void;
  onCancelEdit: () => void;
  onConfirmEdit: () => void;
  onRetract: (id: string) => void;
  onRegenerate: (id: string) => void;
  onSessionModeChange: (mode: AgentSessionMode) => Promise<void>;
  onBuildPlan: () => Promise<void>;
  onClearGoal: () => Promise<void>;
  onPauseGoal: () => Promise<void>;
  onResumeGoal: () => Promise<void>;
  onCycleSessionMode: () => void;
  onClarifySelect: (reply: string) => Promise<void>;
  onModelChange: (value: string) => Promise<void>;
  onThinkingChange: (level: ThinkingLevel) => Promise<void>;
  onToggleThinking: () => Promise<void>;
  onAutoCompactPercentChange: (percent: number) => void;
  onCloseRightPanel: () => Promise<void>;
  onAddPathToChat: (relPath: string) => void;
  onPlanPathChange: (path: string | null) => void;
  onEnableGodotTools: () => Promise<void>;
  openSettingsAt: (tab: "godot" | "general") => void;
};

export type AppMainRowProps = {
  // sidebar state
  sessions: SessionInfo[];
  hiddenProjectKeys: string[];
  activeSessionId: string | null;
  activeCwd: string | null;
  agentStatus: AgentStatus;
  busy: boolean;
  compacting: boolean;
  sessionsLoading: boolean;
  // chat state
  items: ChatItem[];
  showThinking: boolean;
  apiStatus:
    | {
        phase: "thinking" | "receiving" | "retrying";
        waitedMs?: number;
      }
    | null;
  input: string;
  externalStreamRef: RefObject<HTMLDivElement | null>;
  attachments: ImageContent[];
  fileRefs: FileReference[];
  skillsRefreshKey: string;
  queuedSteering: string[];
  forceFollowKey: string;
  sessionType: SessionType;
  isGodotProject: boolean;
  // edit / retract state
  editingEntryId: string | null;
  editDraft: string;
  // session / plan / goal state
  sessionMode: AgentSessionMode;
  planPath: string | null;
  goal: GoalInfo | null;
  // model / thinking state
  models: ModelInfo[];
  currentModelKey: string;
  thinkingLevel: ThinkingLevel;
  availableThinkingLevels: ThinkingLevel[] | null;
  // right panel state
  usage: SessionUsageSnapshot | null;
  sessionId: string | null;
  autoCompactPercent: number;
  // layout
  layout: ReturnType<typeof useAppLayout>;
  setPrefs: (
    p: ClientPrefs | null | ((prev: ClientPrefs | null) => ClientPrefs | null),
  ) => void;
  retractBusy: boolean;
  prefs: ClientPrefs | null;
  // grouped actions
  sidebarActions: AppMainRowSidebarActions;
  chatActions: AppMainRowChatActions;
};

export function AppMainRow(props: AppMainRowProps) {
  const {
    sessions,
    hiddenProjectKeys,
    activeSessionId,
    activeCwd,
    agentStatus,
    busy,
    compacting,
    sessionsLoading,
    items,
    showThinking,
    apiStatus,
    input,
    externalStreamRef,
    attachments,
    fileRefs,
    skillsRefreshKey,
    queuedSteering,
    forceFollowKey,
    sessionType,
    isGodotProject,
    editingEntryId,
    editDraft,
    sessionMode,
    planPath,
    goal,
    models,
    currentModelKey,
    thinkingLevel,
    availableThinkingLevels,
    usage,
    sessionId,
    autoCompactPercent,
    layout,
    setPrefs,
    retractBusy,
    prefs,
    sidebarActions,
    chatActions,
  } = props;

  const chatStarters: ChatStarter[] = useMemo(
    () => startersForProject(isGodotProject, sessionType),
    [isGodotProject, sessionType],
  );

  const readinessHints: { label: string; onClick: () => void }[] | undefined =
    useMemo(() => {
      if (!activeCwd) return undefined;
      const list: { label: string; onClick: () => void }[] = [];
      if (isGodotProject && !allGodotEditorToolsEnabled(prefs)) {
        list.push({
          label: "启用 Godot 工具",
          onClick: () => {
            void chatActions.onEnableGodotTools();
          },
        });
      }
      list.push({
        label: isGodotProject ? "Godot 设置" : "打开设置",
        onClick: () => chatActions.openSettingsAt(isGodotProject ? "godot" : "general"),
      });
      return list;
    }, [activeCwd, isGodotProject, prefs, chatActions]);

  return (
    <div
      className={`main-row${prefs?.rightPanelOpen ? " with-right-panel" : ""}${layout.sidebarResizing || layout.rightPanelResizing ? " is-resizing" : ""}`}
      style={
        {
          "--sidebar-width": `${layout.layoutWidths.sidebar}px`,
          "--right-panel-width": `${layout.layoutWidths.right}px`,
        } as CSSProperties
      }
    >
      <Sidebar
        sessions={sessions}
        hiddenProjectKeys={hiddenProjectKeys}
        activeSessionId={activeSessionId}
        activeCwd={activeCwd}
        agentStatus={agentStatus}
        busy={busy}
        compacting={compacting}
        sessionsLoading={sessionsLoading}
        collapsed={layout.sidebarCollapsed}
        onResume={sidebarActions.onResume}
        onDelete={sidebarActions.onDelete}
        onDeleteProjectSessions={sidebarActions.onDeleteProjectSessions}
        onHideProject={sidebarActions.onHideProject}
        onRename={sidebarActions.onRename}
        onRefresh={sidebarActions.onRefresh}
        onToggleCollapsed={() => layout.onToggleSidebarCollapsed()}
        onResizePointerDown={
          layout.sidebarCollapsed ? undefined : layout.onSidebarResizePointerDown
        }
        onResizeDoubleClick={
          layout.sidebarCollapsed
            ? undefined
            : layout.onSidebarResizeDoubleClick
        }
        resizing={layout.sidebarResizing}
      />
      <ChatPanel
        items={items}
        showThinking={showThinking}
        status={agentStatus}
        apiStatus={apiStatus}
        input={input}
        externalStreamRef={externalStreamRef}
        setInput={chatActions.setInput}
        onSend={chatActions.onSend}
        onAbort={chatActions.onAbort}
        attachments={attachments}
        fileRefs={fileRefs}
        onAddFiles={chatActions.onAddFiles}
        onRemoveImage={chatActions.onRemoveImage}
        onRemoveFile={chatActions.onRemoveFile}
        disabled={!activeCwd}
        modelSupportsImage={modelSupportsImage(models, currentModelKey)}
        currentModelLabel={currentModelKey}
        skillsRefreshKey={skillsRefreshKey}
        queuedSteering={queuedSteering}
        forceFollowKey={forceFollowKey}
        starters={chatStarters}
        sessionType={sessionType}
        readinessHints={readinessHints}
        onPickStarter={chatActions.onPickStarter}
        onOpenToolInPanel={chatActions.onOpenToolInPanel}
        editingEntryId={editingEntryId}
        editDraft={editDraft}
        onEditDraftChange={chatActions.onEditDraftChange}
        onStartEdit={chatActions.onStartEdit}
        onCancelEdit={chatActions.onCancelEdit}
        onConfirmEdit={chatActions.onConfirmEdit}
        onRetract={chatActions.onRetract}
        onRegenerate={chatActions.onRegenerate}
        sessionMode={sessionMode}
        planPath={planPath}
        goal={goal}
        onSessionModeChange={chatActions.onSessionModeChange}
        onBuildPlan={chatActions.onBuildPlan}
        onClearGoal={chatActions.onClearGoal}
        onPauseGoal={chatActions.onPauseGoal}
        onResumeGoal={chatActions.onResumeGoal}
        onCycleSessionMode={chatActions.onCycleSessionMode}
        onClarifySelect={chatActions.onClarifySelect}
        models={models}
        currentModelKey={currentModelKey}
        thinkingLevel={thinkingLevel}
        thinkingLevels={availableThinkingLevels ?? THINKING_LEVELS}
        onModelChange={chatActions.onModelChange}
        onThinkingChange={chatActions.onThinkingChange}
        onToggleThinking={chatActions.onToggleThinking}
      />
      {prefs?.rightPanelOpen && (
        <RightPanel
          cwd={activeCwd}
          items={items}
          enabledTools={prefs?.tools ?? []}
          usage={usage}
          compacting={compacting}
          sessionId={sessionId}
          planPath={planPath}
          autoCompactPercent={autoCompactPercent}
          onAutoCompactPercentChange={chatActions.onAutoCompactPercentChange}
          busy={
            busy ||
            agentStatus === "streaming" ||
            agentStatus === "retrying" ||
            retractBusy
          }
          onClose={chatActions.onCloseRightPanel}
          onAddPathToChat={chatActions.onAddPathToChat}
          onBuildPlan={() => {
            void chatActions.onBuildPlan();
          }}
          onPlanPathChange={chatActions.onPlanPathChange}
          onResizePointerDown={layout.onRightPanelResizePointerDown}
          onResizeDoubleClick={layout.onRightPanelResizeDoubleClick}
          resizing={layout.rightPanelResizing}
        />
      )}
    </div>
  );
}
