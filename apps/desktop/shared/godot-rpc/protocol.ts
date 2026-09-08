/**
 * shared/godot-rpc 子模块 — 协议 (issue #60 主题 D C-302, issue #66 主题 I).
 *
 * 含 wire protocol 常量 + 类型 + 方法名 **single-source of truth**。
 * 增删 RPC method 时, 这是唯一需要修改的源:
 *   1. 在 `GODOT_RPC_METHOD_NAMES` 加/减字面量
 *   2. 在 `GodotRpcCall` 联合类型加/减对应分支
 *   3. 在 `gating.ts` 的 `GODOT_RPC_METHOD_TOOL` 加/减映射
 *   4. 在 `electron/agent/godot-tools.ts` 加/减 `defineTool`
 *   5. 在 `packages/godot-pi/extensions/godot-helpers.ts` 消费同一源(随本 issue I-2 自动同步)
 *   6. 在 `packages/godot-editor-rpc/addons/x_agent_rpc/plugin.gd` 加/减 match 分支
 *
 * cross-check 测试在 `godot-rpc.test.ts`:
 *   - `godot-tools.ts` defineTool name vs `GODOT_RPC_METHOD_TOOL.values`
 *   - `godot-helpers.ts` RPC_METHODS CSV vs `GODOT_RPC_METHOD_NAMES`
 *   - `plugin.gd` match method: case names vs `GODOT_RPC_METHOD_NAMES`
 *
 * 任何一处 drift, vitest 立即报错.
 *
 * gating (白名单 + tool 开关映射) 在 ./gating.ts, policy (clamp +
 * timeout) 在 ./policy.ts.
 */
export const GODOT_RPC_DEFAULT_PORT = 8765;

/**
 * RPC 方法名白名单 — single-source of truth.
 *
 * 整个仓库 (TS 端 / GDScript 端 / cross-check 测试) 都从这里派生。
 * 加减方法: 改这一处 + `GodotRpcCall` 联合类型, 其余地方由
 *   - `gating.ts` (re-export + 工具开关映射)
 *   - `godot-tools.ts` (`defineTool` 注册)
 *   - `godot-helpers.ts` (CSV 字符串)
 *   - `plugin.gd` (match method: 分支)
 * 在编译期 / 测试期被锁定.
 *
 * `as const` 让 TS 把字面量锁成 tuple, 再用 `(typeof X)[number]` 派生
 * `GodotRpcMethodName` 字面量联合, 这样 drift 测试可以直接读这个数组.
 */
export const GODOT_RPC_METHOD_NAMES = [
  "ping",
  "get_editor_info",
  "get_open_scenes",
  "get_edited_scene",
  "open_scene",
  "reload_scene",
  "get_scene_tree",
  "get_node_properties",
  "run_current_scene",
  "play_main_scene",
  "import_resources",
  "get_play_errors",
  "stop_scene",
  // 1.2 扩展：调试器 / 资源治理 / 导出 / 配置读写 / lint
  "get_debugger_state",
  "set_breakpoint",
  "find_unused_resources",
  "export_project",
  "get_project_setting",
  "set_project_setting",
  "lint_scripts",
  // 1.3 扩展：只读文件内省 / UID / 类名 / 脚本反射 / 导出预检
  "list_project_files",
  "resolve_uid",
  "wait_for_import_done",
  "list_global_classes",
  "find_class_name_conflicts",
  "inspect_script",
  "list_export_presets",
  "check_export_templates",
] as const;

export type GodotRpcMethodName = (typeof GODOT_RPC_METHOD_NAMES)[number];

/** 桥与插件一致的回退端口上限（插件候选表 8765–8774）。 */
export const GODOT_RPC_FALLBACK_PORT_END = 8774;

/** Default collection window after play scene methods. */
export const GODOT_RPC_DEFAULT_WAIT_MS = 3000;

/** Upper bound for `wait_ms` (plugin + tools clamp to this). */
export const GODOT_RPC_MAX_WAIT_MS = 15000;

/** Base RPC round-trip timeout (excluding play wait window). */
export const GODOT_RPC_BASE_TIMEOUT_MS = 8000;

/**
 * 项目导出的最长等待时间。
 * `export_project` 走 Godot 子进程 `--headless --export-release`，大项目出包可达数分钟。
 */
export const GODOT_RPC_EXPORT_TIMEOUT_MS = 5 * 60_000;

/**
 * C4: export 桥接超时在插件超时之外追加的余量。
 * 插件侧从「收到请求」起算 5 分钟并主动 kill 子进程 + 回响应；
 * 桥侧多等一个余量，保证永远先收到插件的最终结果（而非桥先 timeout 丢响应）。
 */
export const GODOT_RPC_EXPORT_GRACE_MS = 15_000;

/**
 * 桥接启动后的重连宽限期。
 * 期间就绪清单不提示「未连接」，留给已在运行的 Godot 插件完成重连。
 */
export const GODOT_RPC_GRACE_PERIOD_MS = 8000;

/** Connected Godot editor client (bridge-assigned id). */
export interface GodotRpcClientInfo {
  id: string;
  projectPath?: string;
  godotVersion?: string;
  /** Addon version from plugin.cfg (0.3.0+ only). */
  addonVersion?: string;
  connectedAt: string;
}

/** 1.3：只读内省、UID 与导出预检 工具的请求类型。 */
export type GodotFileKind =
  | "scene"
  | "script"
  | "shader"
  | "resource"
  | "texture"
  | "audio"
  | "other";

export type GodotInspectMember = {
  name: string;
  type?: string;
  /** godot 返回的 hint 语义名（RANGE / ENUM / …，0.6.3+；旧版为数字字符串）。 */
  hint?: string;
  /** hint 详情：range 的 "min,max,step"、enum 的成员名等（0.6.3+）。 */
  hintString?: string;
};

export type GodotExportTemplatesStatus = {
  installed: boolean;
  /** 当前 Godot 版本。 */
  version?: string;
  /** 已安装的模板版本（不一定与 current 一致）。 */
  templateVersion?: string;
  missingPlatforms: string[];
};

/** Call payload without correlation id (desktop assigns id). */
export type GodotRpcCall =
  | { method: "ping" }
  | { method: "get_editor_info" }
  | { method: "get_open_scenes" }
  | { method: "get_edited_scene" }
  | { method: "open_scene"; path: string }
  | { method: "reload_scene"; path: string }
  | { method: "get_scene_tree"; path: string; max_depth?: number }
  | { method: "get_node_properties"; path: string; node_path: string }
  | { method: "run_current_scene"; wait_ms?: number }
  | { method: "play_main_scene"; wait_ms?: number }
  | { method: "import_resources"; paths?: string[] }
  | { method: "get_play_errors"; clear?: boolean }
  | { method: "stop_scene" }
  // 1.2 扩展：调试器 / 资源治理 / 导出 / 配置读写 / lint
  | { method: "get_debugger_state" }
  | { method: "set_breakpoint"; file: string; line: number; condition?: string; remove?: boolean }
  | { method: "find_unused_resources"; root?: string }
  | { method: "export_project"; preset: string; output_dir: string; debug?: boolean }
  | { method: "get_project_setting"; key: string }
  | { method: "set_project_setting"; key: string; value: unknown }
  | { method: "lint_scripts"; paths: string[] }
  // 1.3 扩展：只读文件内省 / UID / 类名 / 脚本反射 / 导出预检
  | {
      method: "list_project_files";
      root?: string;
      type?: string;
      pattern?: string;
      limit?: number;
      cursor?: string;
    }
  | { method: "resolve_uid"; uid?: string; path?: string }
  | { method: "wait_for_import_done"; paths: string[]; timeout_ms?: number }
  | { method: "list_global_classes" }
  | { method: "find_class_name_conflicts"; include_addons?: boolean }
  | { method: "inspect_script"; path: string }
  | { method: "list_export_presets" }
  | { method: "check_export_templates" };

export type GodotRpcRequest = GodotRpcCall & { id: string };

export type GodotRpcResponse =
  | {
      id: string;
      ok: true;
      result: unknown;
      /** C1: 请求被改道送达的客户端（preferred 未鉴权时的 fallback）。 */
      routedTo?: string;
    }
  | {
      id: string;
      ok: false;
      error: string;
      /** C1: 请求被改道送达的客户端（preferred 未鉴权时的 fallback）。 */
      routedTo?: string;
    };

export type GodotRpcEvent =
  | {
      type: "editor_ready";
      godotVersion: string;
      projectPath: string;
      /** Shared secret from x-agent-godot-rpc.json (required by bridge). */
      token?: string;
      /** Addon version from plugin.cfg (reported by 0.3.0+ only). */
      addonVersion?: string;
      clientId?: string;
    }
  | { type: "scene_changed"; path: string; clientId?: string }
  | { type: "play_error"; severity: string; message: string; clientId?: string }
  | { type: "disconnected"; clientId?: string };

/** 握手失败原因，用于就绪清单区分「插件过旧」与「token 不匹配」。 */
export type GodotRpcHandshakeFailure = "missing_token" | "bad_token";

export interface GodotRpcBridgeStatus {
  running: boolean;
  port: number;
  /**
   * 已建立的 TCP 连接数（含尚未通过 token 握手的裸 socket）。
   * 判断「真正连上了」请用 `authenticatedClients`。
   */
  clients: number;
  /** Connected editors with bridge-assigned ids. */
  clientInfos: GodotRpcClientInfo[];
  /** Preferred client for routed requests (null → first connected). */
  activeClientId: string | null;
  lastEvent?: GodotRpcEvent;
  /** Set when the last start attempt failed (e.g. all ports busy). */
  error?: string;
  /** Non-fatal note (e.g. fell back to another port). */
  warning?: string;
  /** 桥接最近一次成功 start 的 Unix ms；renderer 据此计算重连宽限期。 */
  startedAt?: number;
  /** 已通过 token 握手的客户端数。 */
  authenticatedClients?: number;
  /** 自上次 start 以来的握手失败累计次数。 */
  handshakeFailures?: number;
  /** 最近一次握手失败原因。 */
  lastHandshakeFailure?: GodotRpcHandshakeFailure;
  /** 最近一次成功握手上报的插件版本（0.3.0+ 才会上报）。 */
  lastAddonVersion?: string;
}

export type GodotRpcRequestOptions = {
  /** Route to a specific editor client; defaults to activeClientId / first client. */
  clientId?: string | null;
};
