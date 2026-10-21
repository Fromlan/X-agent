# Godot Editor RPC（X-agent）

Godot 4.x 编辑器插件，通过本机 TCP JSON-lines 连接 X-agent 主进程。Agent 可在同一会话中修改项目文件、调用编辑器查询或运行，并读取诊断结果。当前 addon 版本为 **0.6.4**，CI 使用 Godot 4.6.2 验证。

## 安装与连接

1. 在 X-agent 打开 Godot 项目。默认自动连接：优先复用当前项目的编辑器；需要启动时，查找引擎、准备插件并打开项目，健康检查通过后显示「已连接」。
2. 无法确定引擎时，在「设置 → Godot」选择检测到的版本或浏览可执行文件。选择按项目记忆；自动发现检查 PATH、常见 Windows 安装位置及已运行的 Godot，不扫描整个磁盘。C# 项目需要 .NET 引擎。
3. 如果项目已经在未加载插件的 Godot 中打开，应用会准备插件并提示在「项目 → 项目设置 → 插件」启用 **X-agent RPC**，或保存后重新打开项目。不会主动关闭编辑器或重复启动已识别的同项目编辑器。
4. 在「设置 → 工具」勾选需要的 Godot 工具；它们默认关闭，连接成功不代表已授权全部工具。可在「设置 → Godot」关闭自动连接，或点击「连接 Godot」手动重试；桥接启停和 Ping 保留用于诊断。

插件安装到项目的 `addons/x_agent_rpc/`。桌面桥只监听 `127.0.0.1`，默认端口为 `8765`，占用时在 `8765–8774` 中回退。

Endpoint 位于 `%USERPROFILE%\.pi\agent\x-agent-godot-rpc.json`，包含 host、port 和共享令牌。桥接启动优先复用有效记录，插件监测 endpoint 变化并自动重连；正常停止桥接不删除记录，已打开的编辑器可在下次启动后恢复连接。不要将 endpoint 文件或令牌提交到项目仓库。

## Agent 工具

当前提供 **27 个 Godot 工具**，另有不进入 Agent 工具列表的 `ping` 健康检查。

| 工具 | RPC 方法 | 作用 |
|---|---|---|
| `godot_editor_info` | `get_editor_info` | 编辑器版本、项目路径、当前场景和播放状态 |
| `godot_open_scenes` | `get_open_scenes` | 已打开场景 |
| `godot_edited_scene` | `get_edited_scene` | 当前编辑场景 |
| `godot_open_scene` | `open_scene` | 打开场景 |
| `godot_reload_scene` | `reload_scene` | 文件编辑后重载场景 |
| `godot_run_scene` | `run_current_scene` | 运行当前场景并短时收集报错 |
| `godot_run_main_scene` | `play_main_scene` | 运行主场景并短时收集报错 |
| `godot_import_resources` | `import_resources` | 扫描或按路径重新导入资源 |
| `godot_play_errors` | `get_play_errors` | 读取运行错误缓冲，可清空 |
| `godot_stop_scene` | `stop_scene` | 停止运行 |
| `godot_get_scene_tree` | `get_scene_tree` | 读取场景节点树 |
| `godot_get_node_properties` | `get_node_properties` | 读取节点属性描述 |
| `godot_get_debugger_state` | `get_debugger_state` | 调试器与运行状态 |
| `godot_set_breakpoint` | `set_breakpoint` | 添加或移除断点 |
| `godot_find_unused_resources` | `find_unused_resources` | 扫描未使用资源 |
| `godot_export_project` | `export_project` | 按已有导出预设构建项目 |
| `godot_get_project_setting` | `get_project_setting` | 查询项目设置 |
| `godot_set_project_setting` | `set_project_setting` | 经安全校验后修改项目设置 |
| `godot_lint_scripts` | `lint_scripts` | 检查 GDScript，失败时补充行号诊断 |
| `godot_list_project_files` | `list_project_files` | 按类型和模式分页列出文件 |
| `godot_resolve_uid` | `resolve_uid` | 查询 UID 与资源路径 |
| `godot_wait_for_import_done` | `wait_for_import_done` | 等待资源导入完成 |
| `godot_list_global_classes` | `list_global_classes` | 列出全局脚本类 |
| `godot_find_class_name_conflicts` | `find_class_name_conflicts` | 查找全局类名冲突 |
| `godot_inspect_script` | `inspect_script` | 读取脚本反射信息 |
| `godot_list_export_presets` | `list_export_presets` | 列出导出预设 |
| `godot_check_export_templates` | `check_export_templates` | 检查导出模板 |

工具名以 [工具注册表](../../apps/desktop/shared/tools/godot.ts) 为准；RPC 方法与类型见 [protocol.ts](../../apps/desktop/shared/godot-rpc/protocol.ts)，开关映射见 [gating.ts](../../apps/desktop/shared/godot-rpc/gating.ts)。

## 行为与限制

- 场景和脚本主要由 Agent 文件工具修改，再通过 RPC 重载、导入和验证；本插件未提供节点创建、节点属性写入、材质或动画编辑工具。
- 场景读取优先使用当前同名编辑场景的内存状态，否则加载副本，查询时不切换编辑页签。节点属性查询返回名称、类型和 hint 描述，不返回实际属性值。
- Godot 4 的断点不支持条件表达式；`condition` 参数被接受但忽略。
- 项目设置写入经过桌面端共享校验，拒绝 autoload、输入映射、设置覆盖等敏感配置；完整规则见 [godot-project-setting.ts](../../apps/desktop/shared/godot-project-setting.ts)。
- Ask / Plan 仅放行已启用且登记为只读的 Godot 工具。设置页 IPC 同样校验工具开关。
- 对话撤回可以恢复受追踪的磁盘文件，不能完整恢复 Godot 编辑器内存状态；运行和导出等副作用也不能视为可完整撤销。

## 运行报错与等待

`godot_run_scene` / `godot_run_main_scene` 会清空错误缓冲、启动播放并等待收集结果。桌面 Agent 工具默认等待 **1500 ms**，最大 **8000 ms**；直接调用 addon 且省略 `wait_ms` 时，插件自身默认值为 **3000 ms**，上限为 **15000 ms**。桌面调用参数与超时以 [protocol.ts](../../apps/desktop/shared/godot-rpc/protocol.ts) 和 [policy.ts](../../apps/desktop/shared/godot-rpc/policy.ts) 为准。

错误来源包括 Output 的 ERROR/WARN、调试器 Errors 页和断点原因。插件不会因为检测到报错而自动停止播放；长时间运行后继续调用 `godot_play_errors` 获取缓冲。

## 多编辑器与协议

每个 TCP 连接分配客户端 ID；`editor_ready` 上报项目路径、Godot 版本、addon 版本和握手令牌。只有鉴权成功的客户端可接收请求。

设置页可选择活动客户端；调用也可指定 `clientId`。桥接绑定当前会话的 cwd 后，只接受同项目编辑器作为目标；显式目标不存在、未鉴权或属于其他项目时直接失败。默认路由发生回退时，响应通过 `routedTo` 告知实际目标。

每行一个 JSON 对象：请求携带 `id` 和 `method`，响应携带同一 `id` 与成功结果或错误；事件使用 `type`。编辑器会发送就绪、场景变化和运行错误事件。完整契约以共享协议类型与 [plugin.gd](addons/x_agent_rpc/plugin.gd) 为准。

## 连接排查

| 状态 | 核对项 |
|---|---|
| 桥接未启动 | 在设置页启动；检查端口占用和启动错误 |
| 等待编辑器连接 | 确认项目装有插件、插件已启用、编辑器仍打开 |
| 握手失败 | 查看 `missing_token` / `bad_token` 提示，安装配套插件后重启编辑器 |
| 已连接但工具不可用 | 检查「设置 → 工具」开关及当前会话模式 |
| 客户端与项目不匹配 | 确认 X-agent 当前项目和 Godot 打开的项目一致 |
| 修改未出现在编辑器中 | 场景修改后重载，资源修改后重新导入；先处理用户尚未保存的编辑 |

## 开发入口

| 位置 | 职责 |
|---|---|
| `addons/x_agent_rpc/plugin.gd` | TCP 客户端、RPC 分派和编辑器操作 |
| `addons/x_agent_rpc/rpc_debugger.gd` | 运行期错误与调试器信息 |
| `apps/desktop/electron/agent/godot-rpc-bridge.ts` | 桌面 TCP 服务与路由 |
| `apps/desktop/electron/agent/godot-tools.ts` | Pi 工具定义 |
| `apps/desktop/electron/agent/godot-addon-install.ts` | 插件安装 |
| `apps/desktop/scripts/test-godot-integration.ts` | 隔离项目中的真实编辑器检查 |

Godot 文档知识库由 [godot-pi](../godot-pi/README.md) 提供，不经过 RPC。插件版本历史见 [CHANGELOG.md](addons/x_agent_rpc/CHANGELOG.md)。
