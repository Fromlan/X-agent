import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AuthStatus,
  BashCheckResult,
  ClientPrefs,
  GitCheckResult,
  GodotRpcStatusDto,
  PiCliStatus,
} from "@shared/ipc";
import { normalizeProjectKey } from "../lib/group-sessions";
import {
  allGodotEditorToolsEnabled,
  buildReadyItems,
} from "../lib/ready-checklist";

/** Project Godot / auth readiness state extracted from App. */
export function useProjectReadiness(options: {
  cwd: string | null;
  prefs: ClientPrefs | null;
  bash: BashCheckResult | null;
  git: GitCheckResult | null;
  auth: AuthStatus | null;
  piCli: PiCliStatus | null;
  modelCount: number;
}) {
  const { cwd, prefs, bash, git, auth, piCli, modelCount } = options;
  const [isGodotProject, setIsGodotProject] = useState(false);
  const [rpcStatus, setRpcStatus] = useState<GodotRpcStatusDto | null>(null);
  const [addonInstalled, setAddonInstalled] = useState<boolean | null>(null);
  const [readyChecklistHidden, setReadyChecklistHidden] = useState(false);

  const refreshProjectReadiness = useCallback(
    async (projectCwd: string | null) => {
      if (!projectCwd) {
        setIsGodotProject(false);
        setAddonInstalled(null);
        setRpcStatus(null);
        return;
      }
      try {
        const listed = await window.xAgent.listProjectDir("");
        const godot = Boolean(
          listed.ok &&
            listed.entries?.some(
              (e) => !e.isDir && e.name.toLowerCase() === "project.godot",
            ),
        );
        setIsGodotProject(godot);
        if (!godot) {
          setAddonInstalled(null);
          setRpcStatus(null);
          return;
        }
        const [rpc, addonDir] = await Promise.all([
          window.xAgent.godotRpcStatus(),
          window.xAgent.listProjectDir("addons"),
        ]);
        setRpcStatus(rpc);
        const hasAddon = Boolean(
          addonDir.ok &&
            addonDir.entries?.some(
              (e) => e.isDir && e.name.toLowerCase() === "x_agent_rpc",
            ),
        );
        setAddonInstalled(hasAddon);
      } catch {
        setIsGodotProject(false);
        setAddonInstalled(null);
      }
    },
    [],
  );

  useEffect(() => {
    void refreshProjectReadiness(cwd);
  }, [cwd, refreshProjectReadiness]);

  useEffect(() => {
    if (!cwd || !isGodotProject) return;
    const timer = window.setInterval(() => {
      void window.xAgent.godotRpcStatus().then(setRpcStatus);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [cwd, isGodotProject]);

  const projectKey = useMemo(
    () => (cwd ? normalizeProjectKey(cwd) : ""),
    [cwd],
  );

  useEffect(() => {
    setReadyChecklistHidden(false);
  }, [projectKey]);

  const readyItems = useMemo(
    () =>
      buildReadyItems({
        piCli,
        auth,
        modelCount,
        bash,
        git,
        isGodotProject,
        prefs,
        rpc: rpcStatus,
        addonInstalled,
      }),
    [
      piCli,
      auth,
      modelCount,
      bash,
      git,
      isGodotProject,
      prefs,
      rpcStatus,
      addonInstalled,
    ],
  );

  const checklistMuted = Boolean(
    projectKey && prefs?.dismissedReadyChecklistKeys?.includes(projectKey),
  );

  const globalReadyPending = readyItems.some(
    (i) =>
      !i.done &&
      (i.id === "auth" ||
        i.id === "models" ||
        i.id === "piCli" ||
        i.id === "node" ||
        i.id === "bash" ||
        i.id === "git"),
  );
  const projectReadyPending = readyItems.some(
    (i) =>
      !i.done &&
      (i.id === "rpcAddon" || i.id === "rpcBridge" || i.id === "godotTools"),
  );
  const showReadyChecklist =
    !readyChecklistHidden &&
    (globalReadyPending || (projectReadyPending && !checklistMuted));

  const godotToolsNudgeDismissed = Boolean(
    projectKey && prefs?.dismissedGodotToolsNudgeKeys?.includes(projectKey),
  );
  const showGodotToolsNudge =
    isGodotProject &&
    !godotToolsNudgeDismissed &&
    Boolean(rpcStatus?.running) &&
    (rpcStatus?.clients ?? 0) > 0 &&
    !allGodotEditorToolsEnabled(prefs) &&
    !showReadyChecklist;

  return {
    isGodotProject,
    rpcStatus,
    setRpcStatus,
    setAddonInstalled,
    addonInstalled,
    readyChecklistHidden,
    setReadyChecklistHidden,
    refreshProjectReadiness,
    projectKey,
    readyItems,
    showReadyChecklist,
    showGodotToolsNudge,
  };
}
