# X-agent 的 Pi 扩展指南

本文说明当前桌面客户端如何管理和加载 Pi 资源。上下文加载规则见 [agent-context.md](agent-context.md)，内置资源清单见 [godot-pi](../packages/godot-pi/README.md)。

## 扩展类型

| 类型 | 资源 | 在 X-agent 中的作用 |
|---|---|---|
| Prompt Template | `prompts/` 下的 Markdown 文件 | 用户调用 `/name` 后展开为消息，不预装进 system |
| Skill | 含 `SKILL.md` 的目录 | 先提供元数据索引，正文按需读取 |
| Extension | `extensions/` 下的 TypeScript / JavaScript 模块 | 注册工具、命令与事件钩子 |
| Theme | `themes/` 下的 JSON 文件 | Pi 终端主题资源；桌面 GUI 的主题由自己的 CSS token 控制 |
| Package | npm、Git 或本地目录中的 Pi 资源包 | 分发上述资源，由 Pi 资源加载器发现 |

入口为「设置 → 插件」。客户端管理资源文件与安装记录，实际执行和加载由 Pi SDK 完成。

## 资源位置与生效

- 全局资源位于 `~/.pi/agent/{prompts,skills,extensions,themes}/`。
- 当前项目资源位于 `<cwd>/.pi/{prompts,skills,extensions,themes}/`。
- 已安装 Package 按自身清单提供资源。
- X-agent 明确排除用户家目录 `~/.agents/skills`。不能将其他 Agent 已安装的技能视为 X-agent 自动可见。
- 项目技能、禁用技能和策划会话的筛选还受 X-agent 策略控制，详见上下文说明。

修改资源后须执行资源重载或创建新会话；已有会话通过 `session.reload()` 重新发现。仅在 UI 保存文件不代表运行中的资源已更新。

## 工具与界面边界

Extension 注册工具后，还要符合当前会话类型、模式与工具白名单。Ask / Plan 的只读规则及策划会话的写入限制由主进程硬闸执行，提示词不能替代授权检查。

Pi 终端 UI 与 Electron renderer 是两个界面。桌面端通过 `extension-ui.ts` 适配扩展通知等能力，不应假定所有终端交互都能直接显示在桌面窗口。需要新能力时核对适配层与 IPC 契约。

Extension 在主进程运行，具备本机代码执行能力；文件工具的项目路径检查不构成扩展的进程级沙箱。安装前须核对来源及依赖。Package 安装流程跳过 npm lifecycle scripts，但这不限制扩展运行时的能力。

## 模型和供应商

模型与 API 档案由「设置 → 供应商」管理。X-agent 与 Pi CLI 共用 `auth.json`、`models.json`、`settings.json`；供应商启用、模型输入能力及密钥持久化的规则见 [领域词表](context.md) 和 [AGENTS.md](../AGENTS.md)。它们不属于桌面主题或 Prompt Template 配置。

## 本仓库的实现入口

| 位置 | 职责 |
|---|---|
| `apps/desktop/electron/agent/plugin-host.ts` | 全局与项目资源的查询和编辑 |
| `apps/desktop/electron/agent/package-manager.ts` | Package 安装、卸载与记录 |
| `apps/desktop/electron/agent/session-lifecycle.ts` | 创建资源加载器、注册自定义工具与扩展 |
| `apps/desktop/electron/agent/extension-ui.ts` | 桌面扩展界面适配 |
| `packages/godot-pi/package.json` | 内置 Package 的资源清单 |
| `packages/godot-pi/extensions/godot-helpers.ts` | 项目检测工具与 Godot 状态命令 |

## 上游参考

Pi 的具体格式与接口以项目安装的 SDK 版本为准；升级时再核对上游文档。

- [Prompt Templates](https://pi.dev/docs/latest/prompt-templates)
- [Skills](https://pi.dev/docs/latest/skills)
- [Extensions](https://pi.dev/docs/latest/extensions)
- [Themes](https://pi.dev/docs/latest/themes)
- [Packages](https://pi.dev/docs/latest/packages)
- [Models](https://pi.dev/docs/latest/models)
- [SDK](https://pi.dev/docs/latest/sdk)
