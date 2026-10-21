import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  hasGodotEditorToolsEnabled,
  buildReadyItems,
} from "../lib/ready-checklist";
import { isProjectGodotConnected, projectGodotConnection } from "@shared/godot-connection";

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
  const activeCwd = useRef(cwd);
  activeCwd.current = cwd;

  const refreshProjectReadiness = useCallback(
    async (projectCwd: string | null) => {
      if (!projectCwd) {
        setIsGodotProject(false);
        setAddonInstalled(null);
        setRpcStatus(null);
        return;
      }
      try {
        const listed = await window.xAgent.files.list("");
        if (activeCwd.current !== projectCwd) return;
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
        const rpc = await window.xAgent.godot.status();
        if (activeCwd.current !== projectCwd) return;
        setRpcStatus(rpc);
        const addon = projectGodotConnection(projectCwd, rpc)?.addon;
        setAddonInstalled(isProjectGodotConnected(projectCwd, rpc) || Boolean(addon?.installed && addon.enabled && addon.current));
      } catch {
        if (activeCwd.current !== projectCwd) return;
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
    const applyStatus = (status: GodotRpcStatusDto): void => {
      if (activeCwd.current !== cwd) return;
      setRpcStatus(status);
      const addon = projectGodotConnection(cwd, status)?.addon;
      setAddonInstalled(isProjectGodotConnected(cwd, status) || Boolean(addon?.installed && addon.enabled && addon.current));
    };
    const unsubscribe = window.xAgent.godot.onStatus(applyStatus);
    const timer = window.setInterval(() => {
      void window.xAgent.godot.status().then(applyStatus).catch(() => {});
    }, 4000);
    return () => { unsubscribe(); window.clearInterval(timer); };
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
        cwd,
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
      cwd,
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
      !i.done && !i.optional &&
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
    isProjectGodotConnected(cwd, rpcStatus) &&
    !hasGodotEditorToolsEnabled(prefs) &&
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
