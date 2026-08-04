# X-agent RPC addon changelog

## 0.4.0

### 新增 RPC 方法

- `get_scene_tree(path, max_depth?)` — 返回场景节点树（递归序列化 name / type / script）
- `get_node_properties(path, node_path)` — 返回节点属性列表（仅 `SCRIPT_VARIABLE` / `STORAGE` usage）

向后兼容：旧版 0.3.0 客户端遇到新方法会返回 `unknown method` 错误，可继续使用现有 10 个方法。

### 协议版本

- plugin.cfg version 升到 0.4.0
- desktop 侧握手校验通过 `addonVersion` 字段透出；就绪清单会显示「请更新 RPC 插件」
