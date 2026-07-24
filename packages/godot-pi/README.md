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
| Skills | 见下方分类（工作流 + Godot 4 领域知识） |
| Prompt | `/godot-next` |
| Extension | `godot_detect_project` 工具、`/godot-rpc-status` 命令 |

### Skills · 工作流（X-agent）

| Skill | 用途 |
|---|---|
| `godot-project-audit` | 审计 `project.godot` / 目录结构 / autoload |
| `godot-scene-edit` | 安全改场景与脚本，配合 RPC 重载 |
| `godot-rpc-playtest` | 运行场景、收集报错、导入资源 |

### Skills · 架构与语言

| Skill | 用途 |
|---|---|
| `godot-gdscript-patterns` | GDScript 信号 / 场景 / 优化惯用法 |
| `godot-ecs-component` | Entity + Component + Resource 组合 |
| `godot-state-machine` | 有限状态机 |
| `godot-autoload-patterns` | Autoload / EventBus / 全局管理 |

### Skills · 玩法系统

| Skill | 用途 |
|---|---|
| `godot-inventory-system` | 背包 / 拖放 / 格子 |
| `godot-buff-system` | Buff / DoT / 层叠 |
| `godot-weapon-system` | 武器切换与冷却 |
| `godot-skill-upgrade` | 技能树 / 升级 / JSON 配置 |
| `godot-spawn-system` | 波次生成与掉落 |
| `godot-interactive-system` | NPC / 区域交互组件 |
| `godot-save-system` | 存档序列化与加密 |
| `godot-building-system` | GridMap 建造 |
| `godot-farming-system` | 种植 / 浇水 / TileMap |

### Skills · 导航与联机

| Skill | 用途 |
|---|---|
| `godot-navigation-system` | NavigationAgent / AStar / 流场 |
| `godot-pathfinding` | TileMap BFS / 六边形网格寻路 |
| `godot-online-multiplayer` | 多人生成 / 死亡复活 / 场景同步 |

### Skills · 着色器

| Skill | 用途 |
|---|---|
| `godot-shader-fundamentals` | Shader 语法与数学基础 |
| `godot-shader-patterns` | 描边 / 溶解 / 水波等常用特效 |

领域技能整理自 AlphaAgent `default_skills`，frontmatter 已统一为可发现的 `Use when…` 描述。

## 搭配使用

1. 安装本 Pi 包（领域知识与工作流）
2. 在 Godot 项目安装并启用 [`godot-editor-rpc`](../godot-editor-rpc)
3. X-agent：启动 Godot RPC 桥接，并在 **设置 → 工具** 勾选 Godot 工具
