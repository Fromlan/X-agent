# @x-agent/godot-pi

X-agent **原生 Pi Package**：通用工程核（Core）+ Godot 4 领域技能、prompts、轻量 extension。

X-agent 会对索引做分层：非 Godot 项目（无 `project.godot`）只暴露 Core；检测到 Godot 项目时再加入 `godot-*` 技能。

**实时编辑器控制**（重载 / 运行 / 导入、报错回传）见 [`packages/godot-editor-rpc`](../godot-editor-rpc)。

## 安装

### X-agent（推荐）

应用会在适当时机尝试自动安装本包；也可 **设置 → 插件 → Packages → 一键安装 X-agent 原生技能包**（需本机可用全局 `pi` CLI）。

### CLI

```bash
pi install /绝对路径/X-agent/packages/godot-pi
```

## 内容

| 类型 | 名称 |
|---|---|
| Skills · Core | `x-grill`、`x-diagnose`、`x-tdd`、`x-change-brief`、`x-handoff`、`x-glossary`、`x-review`、`x-safe-edit` |
| Skills · Game Flow | `game-plan`、`game-prototype`、`game-test`、`game-expand` |
| Skills · Godot | 仅 Godot 项目索引：见下表 |
| Prompt | `/x-next`、`/godot-next` |
| Extension | `godot_detect_project` 工具、`/godot-rpc-status` 命令 |

### Skills · Core（始终索引）

| Skill | 用途 |
|---|---|
| `x-grill` | 一次一问对齐决策 |
| `x-diagnose` | 单会话诊断循环 |
| `x-tdd` | red-green-refactor |
| `x-change-brief` | 对话收成本地改动简报 |
| `x-handoff` | 会话交接文档 |
| `x-glossary` | 维护 `CONTEXT.md` 术语 |
| `x-review` | 单代理 Standards / Spec 审查 |
| `x-safe-edit` | 小步可逆编辑 + 验证 |


### Skills · Game Flow（始终索引，配合四阶段工作流）

| Skill | 用途 |
|---|---|
| `game-plan` | 策划阶段：灵感/GDD/配置 |
| `game-prototype` | 原型阶段：最小可玩切片 |
| `game-test` | 测试阶段：debug/playtest |
| `game-expand` | 扩充阶段：正式制作/发布 |

### Skills · Godot（仅 `project.godot` 存在时索引）

| Skill | 用途 |
|---|---|
| `godot-docs-4-7` | Godot 4.7 官方文档蒸馏知识库（节点选型 / 场景结构 / GDScript / 渲染与物理 / 多人 / 导出） |

## 搭配使用

1. 安装本包（应用自动或手动）
2. Godot 项目：安装并启用 [`godot-editor-rpc`](../godot-editor-rpc)
3. X-agent：**设置 → Godot → 编辑器连接**，并在 **设置 → 工具** 勾选 Godot 编辑器工具
