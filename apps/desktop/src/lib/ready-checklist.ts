import {
  GODOT_TOOLS,
  type AuthStatus,
  type BashCheckResult,
  type ClientPrefs,
  type GitCheckResult,
  type GodotRpcStatusDto,
  type PiCliStatus,
} from "@shared/ipc";

export type ReadyItemId =
  | "piCli"
  | "node"
  | "auth"
  | "models"
  | "bash"
  | "git"
  | "rpcAddon"
  | "rpcBridge"
  | "godotTools";

export type ReadyItem = {
  id: ReadyItemId;
  label: string;
  detail?: string;
  done: boolean;
  optional?: boolean;
  /** Settings tab to open for this item. */
  settingsTab?: "general" | "providers" | "tools" | "godot" | "plugins";
  /**
   * Preferred primary action for the checklist CTA.
   * Defaults are derived from `id` when omitted.
   */
  actionKind?:
    | "startBridge"
    | "launchEditor"
    | "installAddon"
    | "enableGodotTools"
    | "openSettings"
    | "installPi"
    | "applyBash"
    | "openPiLogin"
    | "openGitDownload"
    | "openNodeDownload";
};

export type ReadyChecklistInput = {
  piCli: PiCliStatus | null;
  auth: AuthStatus | null;
  modelCount: number;
  bash: BashCheckResult | null;
  git: GitCheckResult | null;
  isGodotProject: boolean;
  prefs: ClientPrefs | null;
  rpc: GodotRpcStatusDto | null;
  addonInstalled: boolean | null;
};

export function buildReadyItems(input: ReadyChecklistInput): ReadyItem[] {
  const items: ReadyItem[] = [];

  if (input.piCli && !input.piCli.ok) {
    if (!input.piCli.canInstall) {
      items.push({
        id: "node",
        label: "安装 Node.js 22+",
        detail: input.piCli.message,
        done: false,
        settingsTab: "general",
        actionKind: "openNodeDownload",
      });
    } else {
      items.push({
        id: "piCli",
        label: "安装 Pi CLI",
        detail: input.piCli.message,
        done: false,
        settingsTab: "general",
        actionKind: "installPi",
      });
    }
  }

  if (input.auth && !input.auth.ok) {
    items.push({
      id: "auth",
      label: "配置模型认证",
      detail: input.auth.message,
      done: false,
      settingsTab: "providers",
    });
  } else if (input.auth?.ok && input.modelCount === 0) {
    items.push({
      id: "models",
      label: "配置可用模型",
      detail: "无可用模型。请检查认证或在「供应商」中添加档案。",
      done: false,
      settingsTab: "providers",
    });
  }

  if (input.bash && !input.bash.ok) {
    items.push({
      id: "bash",
      label: "配置终端 (bash)",
      detail: input.bash.message,
      done: false,
      settingsTab: "general",
      actionKind: input.bash.suggestedShellPath
        ? "applyBash"
        : "openGitDownload",
    });
  } else if (
    input.bash?.ok &&
    input.bash.suggestedShellPath &&
    input.bash.message.includes("可写入")
  ) {
    items.push({
      id: "bash",
      label: "写入 bash shellPath",
      detail: "已检测到 bash，但尚未写入 Pi settings。",
      done: false,
      settingsTab: "general",
      actionKind: "applyBash",
    });
  }

  if (input.git && !input.git.ok) {
    items.push({
      id: "git",
      label: "安装 Git（工作区检查点）",
      detail: input.git.message,
      done: false,
      settingsTab: "general",
      actionKind: "openGitDownload",
    });
  }

  if (!input.isGodotProject) return items;

  const toolsEnabled =
    input.prefs != null &&
    GODOT_TOOLS.every((t) => input.prefs!.tools.includes(t));

  items.push({
    id: "rpcAddon",
    label: "安装 X-agent RPC 插件",
    detail: "复制插件到项目并启用 editor_plugins。",
    done: input.addonInstalled === true,
    settingsTab: "godot",
  });

  const bridgeRunning = Boolean(input.rpc?.running);
  const bridgeClients = input.rpc?.clients ?? 0;
  const bridgeOk = bridgeRunning && bridgeClients > 0;
  const bridgePort = input.rpc?.port ?? 8765;
  items.push({
    id: "rpcBridge",
    label: bridgeOk
      ? "连接 Godot 编辑器"
      : bridgeRunning
        ? "等待 Godot 连入"
        : "启动 RPC 桥接",
    detail: bridgeOk
      ? undefined
      : bridgeRunning
        ? `桥接已在端口 ${bridgePort} 运行。请在 Godot 启用 X-agent RPC 插件并保持编辑器打开。`
        : input.rpc?.error
          ? input.rpc.error
          : "点击启动桥接；再在 Godot 中启用插件并保持编辑器打开。",
    done: bridgeOk,
    settingsTab: "godot",
    actionKind: bridgeOk
      ? undefined
      : bridgeRunning
        ? "launchEditor"
        : "startBridge",
  });

  items.push({
    id: "godotTools",
    label: "启用 Godot 编辑器工具",
    detail: "默认关闭；启用后 Agent 才能控制场景与运行。",
    done: toolsEnabled,
    settingsTab: "tools",
  });

  return items;
}

export function readyChecklistHasBlocking(items: ReadyItem[]): boolean {
  return items.some((i) => !i.done && !i.optional);
}

export function allGodotEditorToolsEnabled(prefs: ClientPrefs | null): boolean {
  if (!prefs) return false;
  return GODOT_TOOLS.every((t) => prefs.tools.includes(t));
}
