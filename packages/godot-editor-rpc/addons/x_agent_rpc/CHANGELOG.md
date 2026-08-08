# X-agent RPC addon changelog

## 0.6.0

### 修复

- `list_project_files` cursor 分页重写：`nextCursor` 由 res:// 目录改为 `"#N"`（N = 已返回匹配数），恢复时跳过前 N 个匹配文件，避免目录文件数超 `limit` 时翻页返回重复页；`total` 改为整棵子树中匹配（过滤 type/pattern 后）总数，不随翻页变化。旧格式纯路径 cursor 兼容（从该目录起、不跳过）。
- `check_export_templates` 模板目录路径修正：`exported/templates` → `export_templates`（与 Godot ExportTemplateManager 一致，旧路径恒查不到 → installed 永远 false）；`missingPlatforms` 按已知平台（windows / linux / macos / web / android / ios）枚举全缺平台，`installed` 基于实际模板文件存在性。
- `wait_for_import_done` 路径防御：入参 strip + 自动补 `res://` 前缀（绝对路径由桌面端拒绝），避免 `.import` sidecar 检查失效。
- `_list_project_files` / `find_class_name_conflicts` 5 处 `var :=` 类型推断错误修复（`EditorFileSystemDirectory.get_file_uid` 在 4.7 不存在，改走 `ResourceLoader.get_resource_uid`；BFS 队列补元素类型）。
- `plugin.cfg` version 升到 0.6.0。

### 新增 RPC 方法（1.3 扩展，共 8 个 — 只读文件内省 / UID / 类名 / 脚本反射 / 导出预检）

- `list_project_files(root?, type?, pattern?, limit?, cursor?)` — 经 `EditorFileSystem.get_filesystem_path()` 走 BFS，分类 scene/script/shader/resource/texture/audio/other；支持按 type / 子串 pattern 过滤；默认截断 500 行，最大 5000。`cursor` 缺省 → 返回 `{nextCursor, truncated}` 提示调用方下一批范围。
- `resolve_uid(uid?, path?)` — `ResourceUID.text_to_id` + `get_id_path` 双向查（输入必须二选一）。`ResourceLoader.get_resource_uid` 在 4.4+ 才可用，老版本走 `FileAccess.file_exists` fallback。
- `wait_for_import_done(paths[], timeout_ms?)` — 等 `EditorFileSystem.is_scanning()` 翻假 + 校验 `.import` 侧车文件存在；默认 30s、硬上限 60s。`paths` 为空时直接 400。
- `list_global_classes()` — `ProjectSettings.get_global_class_list()` 透出，含 `class`、`language`、`path`、`icon`。
- `find_class_name_conflicts(include_addons?)` — 在上述注册表基础上再 `.gd` 文本扫顶级 `class_name X` 声明，聚合 `paths.size() > 1` 的冲突名。默认跳过 `addons/`。
- `inspect_script(path)` — `ResourceLoader.load` 后反射 `GDScript.get_signal_list` / `get_script_method_list` / `get_script_property_list` / `get_constants()`；顺手读 `base_script.resource_path` + `instance_base_type`。
- `list_export_presets()` — 行级解析 `res://export_presets.cfg` 的 `[preset.N]` 段，返回 `[{index, name, platform}, …]`；文件缺失时 `{presets:[], missing:true}`。
- `check_export_templates()` — 列 `{OS.get_config_dir()}/export_templates/<EngineVersion>/` 下的模板文件；返回 `installed`、`version`、`templateDir`、`templateFiles`、`missingPlatforms`。

### 兼容性

- 桌面端 `GODOT_RPC_ALLOWED_METHODS` 增量加入上述 8 个 method 名；旧桌面端调新方法按既有约定返回 `unknown method`。
- 与 0.5.0 / 0.4.x 完全向后兼容；`nextCursor` 新格式仅在本次起由本插件生成，旧桌面端仍能透传。

## 0.5.0

### 新增 RPC 方法（1.2 工具扩展，共 7 个）

- `get_project_setting(key)` / `set_project_setting(key, value)` — 读写 ProjectSettings 并保存到 project.godot
- `lint_scripts(paths)` — GDScript 静态检查：进程内 `GDScript.reload()` 快速判错，失败文件用 `--check-only` 子进程补全 `{file, line, message}`；4.4+ 的 reload 错误码有重排，不依赖具体数值
- `find_unused_resources(root?)` — 扫描 res:// 目录，按 `res://` 路径 + `uid://` 引用图找出未被引用的场景 / 脚本 / 资源；`class_name` 脚本与 `addons/` 下文件不计入候选
- `export_project(preset, output_dir, debug?)` — 异步子进程 `--headless --export-release/--export-debug`（`OS.create_process` + 日志轮询），不阻塞编辑器主线程；未知 preset 返回可用列表
- `get_debugger_state()` — 调试器状态聚合：play 状态、会话列表（active / breaked / debuggable）、断点命中数、待重放断点数、play error 缓冲
- `set_breakpoint(file, line, condition?, remove?)` — 经 `EditorDebuggerSession.set_breakpoint()` 生效；会话启动时自动重放未应用断点；Godot 4 断点不支持条件（`condition` 接受但忽略）

### 修复

- `_script_path_of` 的 Variant 推断警告（4.4+ 默认「警告当错误」时无法加载插件）

### 协议版本

- plugin.cfg version 升到 0.5.0

## 0.4.1

### 修复：断开后无法自动重连

- 断线重连时不再每次都重置回主端口：对同一端口连续重试 4 次（约 2s）后推进到下一个候选端口（8765–8774），避免「桥接关闭期间端口被立即拒绝（RST）、永远遍历不到 fallback 端口」导致桥接重启后插件连不上。
- 每次重连前重读 endpoint 文件：X-agent 重启 / 换端口 / token 换新时立即回到新配置的主端口重试。
- 重连间隔从 1s 缩短到 0.5s，桥接重启后插件通常在 1s 内自动恢复，无需重启 Godot。
- 防御损坏或被篡改的 endpoint 端口字段（非法端口回退 8765）。

## 0.4.0

### 新增 RPC 方法

- `get_scene_tree(path, max_depth?)` — 返回场景节点树（递归序列化 name / type / script）
- `get_node_properties(path, node_path)` — 返回节点属性列表（仅 `SCRIPT_VARIABLE` / `STORAGE` usage）

向后兼容：旧版 0.3.0 客户端遇到新方法会返回 `unknown method` 错误，可继续使用现有 10 个方法。

### 协议版本

- plugin.cfg version 升到 0.4.0
- desktop 侧握手校验通过 `addonVersion` 字段透出；就绪清单会显示「请更新 RPC 插件」
