# Pi 个性化扩展制作方案

> 文档基于 https://pi.dev/docs/latest 及其子文档整理。所有具体链接均指向 pi.dev 官方文档。

**与 X-agent**：桌面客户端顶栏「插件」可管理全局 / 项目侧的 Prompt Templates、Skills、Extensions；「设置 → 供应商」可配置 API 档案并写入 Pi 的 `auth.json` / `models.json`（含从供应商拉取模型）。产品用法见仓库 [`README.md`](README.md)，开发约定见 [`CLAUDE.md`](CLAUDE.md)。本文侧重 Pi 扩展类型本身，不替代客户端操作说明。

## 一、方案总览

Pi 提供 5 类扩展机制，按"由轻到重"排序：**Prompt Templates → Themes → Skills → Extensions → Packages**。建议遵循"先用模板与技能解决高频提示问题，再用扩展处理需要 TypeScript 编程的能力，最后通过 Pi Packages 打包分享"的渐进路径。

核心文档入口：

- 文档首页：https://pi.dev/docs/latest
- Quickstart：https://pi.dev/docs/latest/quickstart
- Extensions：https://pi.dev/docs/latest/extensions
- Skills：https://pi.dev/docs/latest/skills
- Prompt Templates：https://pi.dev/docs/latest/prompt-templates
- Themes：https://pi.dev/docs/latest/themes
- Packages：https://pi.dev/docs/latest/packages
- Models：https://pi.dev/docs/latest/models
- Custom Provider：https://pi.dev/docs/latest/custom-provider

---

## 二、五类扩展机制选型对照

| 扩展类型 | 形态 | 加载方式 | 适用场景 | 文档 |
|---|---|---|---|---|
| Prompt Templates | `.md` 文件 | `/name` 命令触发，自动展开 | 标准化常用提示词 | https://pi.dev/docs/latest/prompt-templates |
| Themes | `.json` | 启动加载 | 自定义终端配色 | https://pi.dev/docs/latest/themes |
| Skills | 含 `SKILL.md` 的目录 | 模型按需 `read`，或 `/skill:name` | 封装可复用的工作流 | https://pi.dev/docs/latest/skills |
| Extensions | TypeScript 模块 | 启动挂载 | 注册工具、命令、事件钩子、自定义 UI | https://pi.dev/docs/latest/extensions |
| Pi Packages | npm/git 包 | `pi install` 加载 | 打包并分发完整
功能集合 | https://pi.dev/docs/latest/packages |
| Custom Models | `models.json` | 启动加载 | 为已支持 provider 添加模型条目 | https://pi.dev/docs/latest/models |
| Custom Providers | TypeScript + OAuth | 启动注册 | 对接官方未内置的 API | https://pi.dev/docs/latest/custom-provider |

**选型建议**：

- 仅需统一提示语 → **Prompt Templates**
- 需要工具被 LLM 调用、或拦截工具调用 → **Extensions**
- 团队或跨设备复用一组能力 → **Pi Packages**
- 标准工作流说明文档化 → **Skills**

---

## 三、第一阶段：Prompt Templates 个性化（最简，立即可用）

### 3.1 加载位置

全局目录：`~/.pi/agent/prompts/*.md`

项目目录：`.pi/prompts/*.md`（仅项目被信任后生效）

详见：https://pi.dev/docs/latest/prompt-templates#loading-locations

### 3.2 模板格式（带 frontmatter）

文件名即命令名。`review.md` 对应 `/review`。

```markdown
---
description: Review staged git changes
argument-hint: "[scope]"
---
Review the staged changes (`git diff --cached`). Focus on:
- Bugs and logic errors
- Security issues
- Error handling gaps
```

支持以下变量：

- `$1`、`$2` 位置参数
- `$@` 或 `$ARGUMENTS` 拼接所有参数
- `${1:-default}` 提供默认值
- `${@:N}` 与 `${@:N:L}` 切片

详见：https://pi.dev/docs/latest/prompt-templates#arguments

### 3.3 推荐首批模板

放入 `~/.pi/agent/prompts/`：

```
~/.pi/agent/prompts/
├── review.md          # /review —— 代码审查
├── explain.md         # /explain [target] —— 解释代码
├── test.md            # /test [file] —— 为文件补充测试
├── doc.md             # /doc [symbol] —— 生成文档
├── commit.md          # /commit —— 生成 Conventional Commit
└── refactor.md        # /refactor [focus] —— 建议重构
```

调用方式（来自文档 https://pi.dev/docs/latest/prompt-templates#usage ）：

```
/review
/component Button "click handler"
/explain src/utils/parser.ts
```

---

## 四、第二阶段：Skills 封装高频工作流

### 4.1 Skills 与 Extensions 的本质区别

文档定义见 https://pi.dev/docs/latest/skills 与 https://pi.dev/docs/latest/extensions ：

- **Extensions**：TypeScript 代码，由 Pi 直接挂载
- **Skills**：Markdown 文档 + 可选脚本，仅描述常驻上下文，模型按需 `read`

### 4.2 Skill 目录结构

```
my-skill/
├── SKILL.md           # 必需：frontmatter + 说明
├── scripts/           # 辅助脚本
├── references/        # 按需加载的详细文档
└── assets/            # 模板等资源
```

### 4.3 SKILL.md frontmatter 规范

字段、长度限制、命名规则来源于 https://agentskills.io/specification 与 https://pi.dev/docs/latest/skills#frontmatter ：

| 字段 | 必填 | 限制 |
|---|---|---|
| `name` | 是 | 1–64 字符，小写字母、数字、连字符 |
| `description` | 是 | 最长 1024 字符，决定模型何时加载 |
| `license` | 否 | 自由文本 |
| `compatibility` | 否 | 最长 500 字符的环境说明 |
| `metadata` | 否 | 任意键值 |
| `allowed-tools` | 否 | 空格分隔的预批准工具（实验性） |
| `disable-model-invocation` | 否 | 为 `true` 时必须用 `/skill:name` 调用 |

### 4.4 加载位置

- 全局：`~/.pi/agent/skills/`、`~/.agents/skills/`
- 项目：`.pi/skills/`、`.agents/skills/`（详见 https://pi.dev/docs/latest/skills#loading-locations ）
- 包：`skills/` 目录或 `package.json` 的 `pi.skills` 字段（见 https://pi.dev/docs/latest/packages#pi-manifest ）
- 设置：`settings.json` 中的 `skills` 数组
- CLI：`--skill <path>`

跨 harness 共用示例（来自 https://pi.dev/docs/latest/skills#loading-locations ）：

```json
{
  "skills": [
    "~/.claude/skills",
    "~/.codex/skills"
  ]
}
```

### 4.5 调用方式

```
/skill:brave-search           # 加载并执行
/skill:pdf-tools extract      # 带参数加载
```

参数以 `User: <args>` 行追加到 `SKILL.md` 末尾，由模型按文本解析（见 https://pi.dev/docs/latest/skills#invocation ）。

### 4.6 推荐首批 Skill

```
~/.pi/agent/skills/
├── changelog-gen/
│   └── SKILL.md     # description: Generate CHANGELOG.md from git history
├── pr-review/
│   ├── SKILL.md
│   └── scripts/check.sh
└── api-doc/
    ├── SKILL.md
    └── references/openapi.md
```

完整规范见 https://agentskills.io/specification 。

---

## 五、第三阶段：Extensions 编程扩展（最强能力）

### 5.1 加载位置

来源：https://pi.dev/docs/latest/extensions#locations

| 路径 | 作用域 |
|---|---|
| `~/.pi/agent/extensions/*.ts` | 全局 |
| `~/.pi/agent/extensions/*/index.ts` | 全局（子目录） |
| `.pi/extensions/*.ts` | 项目本地 |
| `.pi/extensions/*/index.ts` | 项目本地（子目录） |

也可通过 `settings.json` 的 `extensions` 字段添加额外路径。

### 5.2 可用导入

| 包 | 用途 |
|---|---|
| `@earendil-works/pi-coding-agent` | `ExtensionAPI`、`ExtensionContext`、事件类型 |
| `typebox` | 工具参数的 schema 定义 |
| `@earendil-works/pi-ai` | `StringEnum` 等 AI 工具 |
| `@earendil-works/pi-tui` | TUI 组件 |

详见：https://pi.dev/docs/latest/extensions#imports

### 5.3 三种组织形式

完整介绍：https://pi.dev/docs/latest/extensions#module-forms

```
单文件          目录形式         包形式（含 npm 依赖）
my-ext.ts       my-ext/          my-ext/
                ├── index.ts     ├── package.json
                └── utils.ts     └── src/index.ts
```

### 5.4 关键生命周期事件

完整事件流参见：https://pi.dev/docs/latest/extensions#events

**启动阶段**：`project_trust` → `session_start` → `resources_discover`

**用户输入流程**：

```
input → before_agent_start → agent_start
       → message_start/update/end
       → turn_start → context → before_provider_*
                     → tool_execution_start
                     → tool_call（可阻塞）
                     → tool_result（可修改）
                     → tool_execution_end
       → turn_end → agent_end → agent_settled
```

**会话切换**：`/new`、`/resume`、`/fork`、`/compact`、`/tree` 都触发对应的 `session_before_*` 与 `session_*` 事件。

### 5.5 ExtensionContext 核心方法

完整字段说明：https://pi.dev/docs/latest/extensions#extensioncontext

| 方法 | 用途 |
|---|---|
| `ctx.ui.notify/confirm/input/select/custom` | 用户交互 |
| `ctx.isProjectTrusted()` | 项目信任状态 |
| `ctx.sessionManager` | 会话只读访问 |
| `ctx.signal` | 中止信号（仅在活动 turn 事件中可用） |
| `ctx.compact({...})` | 触发压缩 |
| `ctx.waitForIdle()` | 等待 agent 完全 settle（仅命令） |
| `ctx.newSession()` / `ctx.fork()` / `ctx.navigateTree()` / `ctx.switchSession()` | 会话控制（仅命令） |
| `ctx.reload()` | 热重载扩展（仅命令） |

### 5.6 ExtensionAPI 关键 API

完整列表：https://pi.dev/docs/latest/extensions#extensionapi

| API | 用途 |
| `pi.registerTool(def)` | LLM 可调用的自定义工具 |
| `pi.registerCommand(name, opts)` | 注册 `/mycommand` 命令 |
| `pi.on(event, handler)` | 订阅生命周期事件 |
| `pi.sendMessage(msg, {deliverAs})` | 注入消息（steer/followUp/nextTurn） |
| `pi.appendEntry(type, data)` | 持久化扩展数据 |
| `pi.registerEntryRenderer(type, fn)` | 自定义 entry 的 TUI 渲染 |
| `pi.registerShortcut` / `pi.registerFlag` | 快捷键与 CLI flag |
| `pi.registerProvider(name, config)` | 动态注册 provider |
| `pi.exec(cmd, args, opts)` | 执行 shell 命令 |
| `pi.setActiveTools` / `getActiveTools` / `getAllTools` | 运行时管理工具 |

### 5.7 推荐首批扩展

```
~/.pi/agent/extensions/
├── safe-bash.ts           # 拦截危险 rm -rf、sudo 等命令
├── git-context.ts         # 自动注入 git status/diff 到上下文
├── token-counter.ts       # /token 命令：显示当前上下文用量
├── session-tagger.ts      # /tag 命令：为关键 entry 打标签
└── clipboard.ts           # /copy 命令：复制最后输出到剪贴板
```

---

## 六、第四阶段：自定义主题与模型

### 6.1 Themes

文档：https://pi.dev/docs/latest/themes

主题为 `.json` 文件，定义 Pi 终端配色。加载位置与提示模板、技能一致。

### 6.2 Custom Models

文档：https://pi.dev/docs/latest/models

为已支持的 provider 添加额外的模型条目（如新增 Claude 系列、GPT 系列模型），无需编程。

### 6.3 Custom Providers

文档：https://pi.dev/docs/latest/custom-provider

通过 `pi.registerProvider()` 实现全新 API 协议或 OAuth 流程，例如对接企业内部 LLM 网关。

---

## 七、第五阶段：Pi Packages 打包分享

### 7.1 安装与共享命令

完整列表：https://pi.dev/docs/latest/packages#install-and-manage

```
pi install npm:@foo/bar@1.0.0
pi install git:github.com/user/repo@v1
pi install /absolute/path/to/package
pi remove npm:@foo/bar
pi list
pi update
pi update --all
pi update --self
```

支持三种来源：https://pi.dev/docs/latest/packages#sources

- **npm**：`npm:@scope/pkg@1.2.3` 或 `npm:pkg`
- **git**：`git:github.com/user/repo@v1`，支持 HTTPS/SSH
- **本地路径**：`/absolute/path` 或 `./relative/path`

### 7.2 声明资源两种方式

来源：https://pi.dev/docs/latest/packages#manifest

**方式 A：`pi` manifest**

```json
{
  "name": "my-pi-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"],
    "video": "https://example.com/demo.mp4",
    "image": "https://example.com/screenshot.png"
  }
}
```

`video` 与 `image` 用于 https://pi.dev/packages 预览。

**方式 B：约定目录**（无 manifest 时自动发现）

- `extensions/`：加载 `.ts`/`.js` 文件
- `skills/`：递归查找 `SKILL.md`
- `prompts/`：加载 `.md` 文件
- `themes/`：加载 `.json` 文件

详见：https://pi.dev/docs/latest/packages#convention-directories

### 7.3 依赖管理

详见：https://pi.dev/docs/latest/packages#dependencies

Pi 核心包必须放入 `peerDependencies`（使用 `"*"` 范围）：

- `@earendil-works/pi-ai`
- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`
- `typebox`

### 7.4 作用域与去重

https://pi.dev/docs/latest/packages#scope-and-deduplication 规则：项目条目优先；带 `autoload: false` 时作为全局条目的 delta。

---

## 八、安全与最佳实践

来自：https://pi.dev/docs/latest/security 、 https://pi.dev/docs/latest/extensions#security 、 https://pi.dev/docs/latest/packages#security

1. **扩展与包以完全系统权限运行**，安装第三方包前必须审阅源码
2. **不要在扩展工厂中启动长生命周期资源**（进程、socket、定时器），应推迟到 `session_start`
3. **工具结果必须截断**，避免压垮 LLM 上下文（https://pi.dev/docs/latest/extensions#truncation ）
4. **文件变更使用 `withFileMutationQueue()`**，避免并发覆盖（https://pi.dev/docs/latest/extensions#file-mutation-queue ）
5. **工具执行失败必须 throw**，返回值不会设置错误标志
6. **状态存入 `details`**，而非闭包变量，支持会话分支
7. **路径参数需规范化前导 `@`**，与内置工具保持一致
8. **字符串枚举使用 `StringEnum`**（来自 `@earendil-works/pi-ai`），`Type.Union`/`Type.Literal` 在 Google API 上无效

---

## 九、实施路线（建议 4 周推进）

| 周次 | 任务 | 输出物 | 参考 |
|---|---|---|---|
| 第 1 周 | 配置 `~/.pi/agent/prompts/` 首批模板 | 6 个 `.md` 模板 | https://pi.dev/docs/latest/prompt-templates |
| 第 2 周 | 编写 2–3 个 Skill（带脚本） | `~/.pi/agent/skills/` | https://pi.dev/docs/latest/skills |
| 第 3 周 | 开发首个 TypeScript 扩展（注册工具 + 命令 + 事件钩子） | `~/.pi/agent/extensions/` | https://pi.dev/docs/latest/extensions |
| 第 4 周 | 打包为 `pi-package`，加入 `pi-package` 关键字发布到 npm 或 git | `package.json` + 资源目录 | https://pi.dev/docs/latest/packages |

每个阶段用 `pi -e ./path.ts` 调试扩展，用 `/reload` 热重载，用 `pi config` 控制资源启用/禁用。

---

## 十、决策建议

如果目标是**立刻提升日常编码效率**，优先实施 **Prompt Templates + Skills**（无编程成本）。

如果目标是**为 LLM 增加专属能力**（如公司内部工具、特定领域 API），优先实施 **Extensions**。

如果目标是**团队或多设备复用**，直接以 **Pi Packages** 形式打包所有资源并通过 git 私有仓库或私有 npm registry 分享。

---

## 十一、关键参考链接汇总

- Pi 文档首页：https://pi.dev/docs/latest
- Quickstart：https://pi.dev/docs/latest/quickstart
- Using Pi：https://pi.dev/docs/latest/usage
- Providers：https://pi.dev/docs/latest/providers
- Security：https://pi.dev/docs/latest/security
- Settings：https://pi.dev/docs/latest/settings
- Keybindings：https://pi.dev/docs/latest/keybindings
- Sessions：https://pi.dev/docs/latest/sessions
- Compaction：https://pi.dev/docs/latest/compaction
- Extensions（核心）：https://pi.dev/docs/latest/extensions
- Skills：https://pi.dev/docs/latest/skills
- Prompt Templates：https://pi.dev/docs/latest/prompt-templates
- Themes：https://pi.dev/docs/latest/themes
- Packages：https://pi.dev/docs/latest/packages
- Custom Models：https://pi.dev/docs/latest/models
- Custom Provider：https://pi.dev/docs/latest/custom-provider
- Session Format：https://pi.dev/docs/latest/session-format
- Development：https://pi.dev/docs/latest/development
- SDK：https://pi.dev/docs/latest/sdk
- RPC Mode：https://pi.dev/docs/latest/rpc
- JSON Event Stream：https://pi.dev/docs/latest/json
- TUI Components：https://pi.dev/docs/latest/tui
- Containerization：https://pi.dev/docs/latest/containerization
- Windows 平台：https://pi.dev/docs/latest/windows
- GitHub 仓库：https://github.com/earendil-works/pi/tree/main/packages/coding-agent
- 示例扩展目录：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions
- Package Gallery：https://pi.dev/packages
- Agent Skills 规范：https://agentskills.io/specification
