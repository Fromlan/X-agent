import {
  GODOT_TOOLS,
  type AuthStatus,
  type BashCheckResult,
  type ClientPrefs,
  type GitCheckResult,
  type GodotRpcStatusDto,
  type PiCliStatus,
} from "@shared/ipc";
import { GODOT_RPC_GRACE_PERIOD_MS } from "@shared/godot-rpc";

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

  // Godot RPC 桥接状态分五态：
  //   1) 启动宽限期内 → 暂不提示「未连接」，等插件重连
  //   2) 已有鉴权连接 → 完成
  //   3) 有裸 socket 但握手全失败 → 提示更新插件
  //   4) 桥接未启动 → 启动桥接
  //   5) 桥接在跑但完全无连接 → 启动编辑器
  const bridgeRunning = Boolean(input.rpc?.running);
  const bridgePort = input.rpc?.port ?? 8765;
  const bridgeStartedAt = input.rpc?.startedAt ?? 0;
  const authenticatedClients = input.rpc?.authenticatedClients ?? 0;
  const totalClients = input.rpc?.clients ?? 0;
  const bridgeOk = bridgeRunning && authenticatedClients > 0;
  const handshakeFailures = input.rpc?.handshakeFailures ?? 0;
  const lastHandshakeFailure = input.rpc?.lastHandshakeFailure;
  const lastAddonVersion = input.rpc?.lastAddonVersion;
  const rpcWarning = input.rpc?.warning;
  // 桥接真的在跑、且已超过宽限期，才算"稳态未连接"；否则按宽限内处理。
  const bridgeInGrace =
    !bridgeRunning ||
    (bridgeStartedAt > 0 && Date.now() - bridgeStartedAt < GODOT_RPC_GRACE_PERIOD_MS);

  if (bridgeOk) {
    items.push({
      id: "rpcBridge",
      label: "连接 Godot 编辑器",
      done: true,
      settingsTab: "godot",
    });
  } else if (bridgeInGrace) {
    items.push({
      id: "rpcBridge",
      label: "RPC 桥接启动中",
      detail: `桥接已在端口 ${bridgePort} 上线，正在等待 Godot 插件连入（最多 ${Math.round(
        GODOT_RPC_GRACE_PERIOD_MS / 1000,
      )}s）。`,
      done: false,
      optional: true,
      settingsTab: "godot",
    });
  } else if (bridgeRunning && totalClients > 0 && authenticatedClients === 0) {
    // 状态三：有连接尝试但全部握手失败 → 引导更新插件
    const hintLines: string[] = [];
    if (handshakeFailures > 0) {
      hintLines.push(
        `检测到 ${handshakeFailures} 次连接尝试，但全部握手失败。`,
      );
    }
    if (lastHandshakeFailure === "missing_token") {
      hintLines.push("插件未发送 token（版本过旧）。");
    } else if (lastHandshakeFailure === "bad_token" && lastAddonVersion) {
      hintLines.push(
        `插件版本 v${lastAddonVersion} 与当前 X-agent 不匹配。`,
      );
    } else if (lastHandshakeFailure === "bad_token") {
      hintLines.push("token 不匹配 —— 插件可能过旧或多次启动后未更新。");
    }
    if (rpcWarning) hintLines.push(`详情：${rpcWarning}`);
    items.push({
      id: "rpcBridge",
      label: "更新 X-agent RPC 插件",
      detail: hintLines.join("\n") || "握手失败，请重新安装 RPC 插件并重启 Godot。",
      done: false,
      settingsTab: "godot",
      actionKind: "installAddon",
    });
  } else if (!bridgeRunning) {
    items.push({
      id: "rpcBridge",
      label: "启动 RPC 桥接",
      detail: input.rpc?.error ?? "点击启动桥接；再在 Godot 中启用插件并保持编辑器打开。",
      done: false,
      settingsTab: "godot",
      actionKind: "startBridge",
    });
  } else {
    items.push({
      id: "rpcBridge",
      label: "启动 Godot 编辑器",
      detail: `桥接已在端口 ${bridgePort} 运行。请打开 Godot 编辑器并启用 X-agent RPC 插件。`,
      done: false,
      settingsTab: "godot",
      actionKind: "launchEditor",
    });
  }

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
