# @x-agent/godot-pi

面向 Godot 的 [Pi Package](https://pi.dev/docs/latest/packages)：skills / prompts / 轻量 extension，配合 X-agent 使用。

**实时编辑器控制**（重载 / 运行 / 导入、报错回传、多编辑器选路）见桌面 Godot RPC：[`packages/godot-editor-rpc`](../godot-editor-rpc)。

## 安装

### X-agent（推荐）

**设置 → 插件 → Packages → 一键安装 Godot Pi 包**  
（使用打包资源或仓库内 `packages/godot-pi`；需本机可用全局 `pi` CLI。）

### CLI

```bash
pi install /绝对路径/X-agent/packages/godot-pi
```

也可将包链接/拷贝到项目 `.pi/` 约定目录。

## 内容

| 类型 | 名称 |
|---|---|
| Skills | `godot-project-audit`、`godot-scene-edit`、`godot-rpc-playtest` |
| Prompt | `/godot-next` |
| Extension | `godot_detect_project` 工具、`/godot-rpc-status` 命令 |

## 搭配使用

1. 安装本 Pi 包（领域知识与工作流）
2. 在 Godot 项目安装并启用 [`godot-editor-rpc`](../godot-editor-rpc)
3. X-agent：启动 Godot RPC 桥接，并在 **设置 → 工具** 勾选 Godot 工具
