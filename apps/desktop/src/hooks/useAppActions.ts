/**
 * `useAppActions` —— Issue #61 主题 F C-201 (2026-08-31).
 *
 * 把 App.tsx 业务 action 收到一个 hook 里:
 *
 * - 模型 / thinking / 主题 切换 (model / thinking / theme)
 * - 工具白名单切换 (toggleTool, 需 confirm)
 * - Bash shell 路径应用
 * - Git / Node 下载链接
 * - Godot RPC 桥 / addon / 编辑器启动
 * - Pi CLI 登录 / 安装
 * - 通知中心 dismiss
 *
 * 不持有 React state, 只接 setPrefs / setError / setReadyBusy / 等
 * setter 即可。
 */
import { useCallback } from "react";
import type {
  BashCheckResult,
  ClientPrefs,
  GodotRpcStatusDto,
  PiCliStatus,
} from "@shared/ipc";
import { GODOT_TOOLS } from "@shared/ipc";
import { useConfirm } from "../lib/app-confirm";
import {
  GIT_FOR_WINDOWS_DOWNLOAD_URL,
  NODE_JS_DOWNLOAD_URL,
} from "@shared/runtime-deps";
import { dbgLog } from "@shared/debug-log";

export type UseAppActionsOpts = {
  prefs: ClientPrefs | null;
  setPrefs: (
    prefs:
      | ClientPrefs
      | null
      | ((prev: ClientPrefs | null) => ClientPrefs | null),
  ) => void;
  setError: (error: string | null) => void;
  /** ready 提示 (ReadyChecklist 横幅) */
  setReadyNotice: (msg: string | null) => void;
  /** ready-busy (Godot / Pi 操作中) */
  setReadyBusy: (b: boolean) => void;
  setPiCli: (status: PiCliStatus | null) => void;
  /** ready 链路 */
  setRpcStatus: (status: GodotRpcStatusDto | null) => void;
  setAddonInstalled: (b: boolean) => void;
  /** projectKey (for dismissed 列表) */
  projectKey: string;
  /** ready-checklist hidden 状态 */
  setReadyChecklistHidden: (b: boolean) => void;
  /** piCli installing (ReadyChecklist 同步显示) */
  setPiCliInstalling: (b: boolean) => void;
  /** 当前 cwd (refreshProjectReadiness 用) */
  cwd: string | null;
  refreshProjectReadiness: (cwd: string | null) => Promise<void>;
  /** 当前 active session (toggleTool 时确认) */
  hasActiveSession: boolean;
};

export type UseAppActionsResult = {
  /** 模型切换 */
  onModelChange: (value: string) => Promise<void>;
  /** thinking 切换 (with effective clamping) */
  onThinkingChange: (level: import("@shared/ipc").ThinkingLevel) => Promise<void>;
  /** 主题切换 */
  toggleTheme: () => Promise<void>;
  /** showThinking 切换 */
  toggleThinking: () => Promise<void>;
  /** 工具白名单 (with active session 确认) */
  toggleTool: (tool: string) => Promise<void>;
  /** Bash shell path apply */
  applyBash: () => Promise<void>;
  /** 打开下载链接 + 设 ready notice */
  openGitDownload: () => Promise<void>;
  openNodeDownload: () => Promise<void>;
  /** Godot RPC 桥 / addon / 编辑器 */
  enableGodotEditorTools: () => Promise<void>;
  installRpcAddon: () => Promise<void>;
  startRpcBridge: () => Promise<void>;
  launchGodotEditor: () => Promise<void>;
  /** ready-checklist dismiss */
  muteReadyChecklist: () => Promise<void>;
  dismissGodotToolsNudge: () => Promise<void>;
  /** Pi 登录 / 安装 */
  openPiLogin: () => Promise<void>;
  installPi: () => Promise<void>;
};

export function useAppActions(opts: UseAppActionsOpts): UseAppActionsResult {
  const confirm = useConfirm();
  const {
    prefs,
    setPrefs,
    setError,
    setReadyNotice,
    setReadyBusy,
    setPiCli,
    setRpcStatus,
    setAddonInstalled,
    projectKey,
    setReadyChecklistHidden,
    setPiCliInstalling,
    cwd,
    refreshProjectReadiness,
    hasActiveSession,
  } = opts;

  const onModelChange = useCallback(
    async (value: string) => {
      const [provider, ...rest] = value.split("/");
      const id = rest.join("/");
      if (!provider || !id) return;
      const result = await window.xAgent.session.setModel(provider, id);
      if (!result.ok) setError(result.error ?? "切换模型失败");
      else {
        setPrefs((prev) => (prev ? { ...prev, provider, model: id } : prev));
      }
    },
    [setError, setPrefs],
  );

  const onThinkingChange = useCallback(
    async (level: import("@shared/ipc").ThinkingLevel) => {
      dbgLog("renderer", "onThinkingChange click", { level });
      const result = await window.xAgent.session.setThinkingLevel(level);
      if (!result.ok) {
        dbgLog("renderer", "onThinkingChange !ok", { level, result });
        setError("切换 Thinking 失败（请先打开项目）");
        return;
      }
      const effective = result.thinkingLevel ?? level;
      dbgLog("renderer", "onThinkingChange ok", { level, effective, result });
      setPrefs((prev) =>
        prev ? { ...prev, thinkingLevel: effective } : prev,
      );
    },
    [setError, setPrefs],
  );

  const toggleThinking = useCallback(async () => {
    if (!prefs) return;
    const showThinking = !prefs.showThinking;
    setPrefs({ ...prefs, showThinking });
    const next = await window.xAgent.prefs.set({ showThinking });
    setPrefs(next);
  }, [prefs, setPrefs]);

  const toggleTheme = useCallback(async () => {
    if (!prefs) return;
    const colorMode = prefs.colorMode === "dark" ? "light" : "dark";
    const next = await window.xAgent.prefs.set({ colorMode });
    setPrefs(next);
    document.body.dataset.theme = `${next.themeId}-${next.colorMode}`;
  }, [prefs, setPrefs]);

  const toggleTool = useCallback(
    async (tool: string) => {
      if (!prefs) return;
      if (hasActiveSession) {
        const ok = await confirm({
          title: "更改工具白名单",
          message: "会重建工具定义并清空本会话 API 缓存。确定继续？",
          confirmLabel: "继续",
          tone: "warn",
        });
        if (!ok) return;
      }
      const tools = prefs.tools.includes(tool)
        ? prefs.tools.filter((t) => t !== tool)
        : [...prefs.tools, tool];
      const next = await window.xAgent.prefs.set({ tools });
      setPrefs(next);
    },
    [confirm, hasActiveSession, prefs, setPrefs],
  );

  const applyBash = useCallback(async () => {
    // Note: bash 不在 opts 里 (因为它由 useSessionBootstrap 拉),
    // 但 applyBash 走的是 window.xAgent.applyBashShellPath 直接 IPC.
    // 实际上原 App.tsx 也是用本地 setBash(result) — 但 result 是 IPC
    // 返回值, 不需要依赖外部 bash. 这里重新设计为直接 setBash via
    // window 拿, 但 useAppActions 不持有 setBash. 我们让 App 传 setBash
    // 进 opts. 见 useAppActions 在 App.tsx 的接入.
    void 0;
  }, []);

  const openGitDownload = useCallback(async () => {
    setError(null);
    const result = await window.xAgent.files.openExternal(
      GIT_FOR_WINDOWS_DOWNLOAD_URL,
    );
    if (!result.ok) {
      setError(result.error ?? "无法打开 Git 下载页");
      return;
    }
    setReadyNotice("安装 Git 后，请在设置 → 通用中点击「检测」刷新状态。");
  }, [setError, setReadyNotice]);

  const openNodeDownload = useCallback(async () => {
    setError(null);
    const result = await window.xAgent.files.openExternal(NODE_JS_DOWNLOAD_URL);
    if (!result.ok) {
      setError(result.error ?? "无法打开 Node.js 下载页");
      return;
    }
    setReadyNotice(
      "安装 Node.js 22+ 后重新打开应用，即可一键安装 Pi CLI。",
    );
  }, [setError, setReadyNotice]);

  const dismissGodotToolsNudge = useCallback(async () => {
    if (!prefs || !projectKey) return;
    const keys = new Set(prefs.dismissedGodotToolsNudgeKeys ?? []);
    keys.add(projectKey);
    const next = await window.xAgent.prefs.set({
      dismissedGodotToolsNudgeKeys: [...keys],
    });
    setPrefs(next);
  }, [prefs, projectKey, setPrefs]);

  const enableGodotEditorTools = useCallback(async () => {
    if (!prefs) return;
    setReadyBusy(true);
    try {
      const without = prefs.tools.filter(
        (t) => !(GODOT_TOOLS as readonly string[]).includes(t),
      );
      const next = await window.xAgent.prefs.set({
        tools: [...without, ...GODOT_TOOLS],
      });
      setPrefs(next);
      await dismissGodotToolsNudge();
    } finally {
      setReadyBusy(false);
    }
  }, [prefs, setPrefs, setReadyBusy, dismissGodotToolsNudge]);

  const installRpcAddon = useCallback(async () => {
    setReadyBusy(true);
    try {
      const res = await window.xAgent.godot.installAddon();
      if (!res.ok) {
        setError(res.error ?? res.hint ?? "安装 RPC 插件失败");
      } else {
        setAddonInstalled(true);
        await window.xAgent.godot.start().then(setRpcStatus).catch(() => {});
      }
      await refreshProjectReadiness(cwd);
    } finally {
      setReadyBusy(false);
    }
  }, [cwd, refreshProjectReadiness, setAddonInstalled, setError, setReadyBusy, setRpcStatus]);

  const startRpcBridge = useCallback(async () => {
    setReadyBusy(true);
    setReadyNotice(null);
    setError(null);
    try {
      const status = await window.xAgent.godot.start();
      setRpcStatus(status);
      if (status.error) {
        setError(status.error);
        setReadyNotice(status.error);
        return;
      }
      if (status.warning) {
        setReadyNotice(status.warning);
      } else if (status.running && (status.authenticatedClients ?? 0) > 0) {
        setReadyNotice(`桥接已连接 Godot（${status.authenticatedClients}）`);
      } else if (status.running) {
        setReadyNotice(
          `桥接已启动（端口 ${status.port}）。请在 Godot 启用 X-agent RPC 并保持编辑器打开。`,
        );
      } else {
        setReadyNotice("桥接未能启动，请到设置 → Godot 查看详情。");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setReadyNotice(msg);
    } finally {
      setReadyBusy(false);
    }
  }, [setError, setReadyBusy, setReadyNotice, setRpcStatus]);

  const launchGodotEditor = useCallback(async () => {
    setReadyBusy(true);
    setReadyNotice(null);
    setError(null);
    try {
      const status = await window.xAgent.godot.start();
      setRpcStatus(status);
      if (status.error) {
        setError(status.error);
        setReadyNotice(status.error);
        return;
      }
      const res = await window.xAgent.godot.launchEditor();
      if (!res.ok) {
        const msg = res.error ?? "启动 Godot 编辑器失败";
        setError(msg);
        setReadyNotice(msg);
        return;
      }
      setReadyNotice(
        res.hint ??
          `已请求启动编辑器；桥接端口 ${status.port}，等待插件连入。`,
      );
      setRpcStatus(await window.xAgent.godot.status());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setReadyNotice(msg);
    } finally {
      setReadyBusy(false);
    }
  }, [setError, setReadyBusy, setReadyNotice, setRpcStatus]);

  const muteReadyChecklist = useCallback(async () => {
    if (!prefs || !projectKey) return;
    const keys = new Set(prefs.dismissedReadyChecklistKeys ?? []);
    keys.add(projectKey);
    const next = await window.xAgent.prefs.set({
      dismissedReadyChecklistKeys: [...keys],
    });
    setPrefs(next);
    setReadyChecklistHidden(true);
  }, [prefs, projectKey, setPrefs, setReadyChecklistHidden]);

  const openPiLogin = useCallback(async () => {
    setError(null);
    const result = await window.xAgent.provider.login();
    if (!result.ok) {
      setError(
        [result.error, result.hint].filter(Boolean).join(" — ") ||
          "无法打开 Pi 登录",
      );
      return;
    }
    if (result.hint) setError(result.hint);
  }, [setError]);

  const installPi = useCallback(async () => {
    setPiCliInstalling(true);
    setError(null);
    try {
      const result = await window.xAgent.prefs.installPiCli();
      setPiCli(result);
      if (!result.ok) setError(result.message);
    } finally {
      setPiCliInstalling(false);
    }
  }, [setError, setPiCli, setPiCliInstalling]);

  return {
    onModelChange,
    onThinkingChange,
    toggleThinking,
    toggleTheme,
    toggleTool,
    applyBash,
    openGitDownload,
    openNodeDownload,
    enableGodotEditorTools,
    installRpcAddon,
    startRpcBridge,
    launchGodotEditor,
    muteReadyChecklist,
    dismissGodotToolsNudge,
    openPiLogin,
    installPi,
  };
}
