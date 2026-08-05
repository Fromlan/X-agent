# X-agent RPC addon changelog

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
