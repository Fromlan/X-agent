# agent.md

> 通用编码 Agent 在本仓库工作时的入口文档。Pi 的 `DefaultResourceLoader` 会将本文件与 `context.md`、`CLAUDE.md` 一起作为 `<project_context>` 注入到系统提示（**全文**，非索引；见 `agent-context.md` 第 3 节）。
>
> 本文不重复 `CLAUDE.md`（开发者向）和 `agent-context.md`（模型上下文原理）的细节，只点出 Agent 工作中**反复需要用到**的事实。
>
> 维护原则：对外约定请写在本文件、`context.md` 或 `CLAUDE.md`；`docs/` 下的 ADR / 调研 / code-review 草稿不入 git、不参与协作，清理后下次会话可重建。

---

## 一、项目是什么

**X-agent**：基于 [Pi SDK](https://pi.dev) 的 Electron 桌面编码 Agent，当前定位是 **Godot 4** 专用——同一会话里改场景/脚本、通过编辑器 RPC（重载/运行/导入）驱动 Godot、并查 `godot-docs-4-7` 知识库。

- 不是通用多语言 IDE 替代品；Godot 不是"一个插件"，是**核心工作面**。
- 运行时复用 Pi 的认证与模型（`~/.pi/agent/auth.json`、`models.json`），会话与 Pi CLI **隔离**（写到 `~/.pi/agent/x-agent/sessions/`）。
- 当前版本见 `apps/desktop/package.json`（如 `0.4.0`）；版本号以该文件为权威源。

## 二、目录速览

仓库只有一个实际应用 `apps/desktop`，根 `package.json` 仅转发脚本：

| 路径 | 角色 |
|---|---|
| `apps/desktop/` | Electron 主应用（main / preload / renderer / shared） |
| `apps/desktop/electron/agent/` | 主进程 agent 模块：会话、模型、供应商、Godot、撤回、检查点等 |
| `apps/desktop/electron/agent/session-mode/` | **会话模式实现**：Ask / Plan / Goal / Bash 只读闸门 |
| `apps/desktop/electron/ipc/` | 按分面拆分的 8 个 `register-*-ipc.ts`（workspace/turn/plan/session/session-config/provider/godot/update） |
| `apps/desktop/shared/` | main / renderer 共享类型与 `mode-tools`、`mode-prompt`、`transcript/` 等 |
| `apps/desktop/src/` | React 19 renderer：组件、hooks、stores、lib、styles |
| `packages/godot-editor-rpc` | Godot 4.x 编辑器插件（TCP JSON-lines 客户端） |
| `packages/godot-pi` | **X-agent 原生 Pi Package**：Core 技能 + Godot 4.7 文档技能 + prompts + 轻量 extension |
| `scripts/` | 发版与工具脚本（`prepare-release` / `extract-changelog` 等） |
| `.github/workflows/` | `ci.yml`（typecheck + test + build）、`release.yml`（tag 触发 → GitHub Release） |

## 三、技术栈与版本下限

- **Electron** ^43 + **electron-vite** ^5 + **electron-builder** ^26（仅 NSIS 安装包，不产便携版）
- **React** 19 + **TypeScript** ^7.0 + **Vite** ^7；UI 库为 `@tanstack/react-virtual` / `lucide-react` / `react-markdown` / `remark-gfm`
- **@earendil-works/pi-coding-agent** ^0.83（实际承担 LLM 上下文组装、会话管理、compaction；X-agent **不**手写 system prompt，详见 `agent-context.md`）
- 字体：`@fontsource/inter` + `@fontsource/jetbrains-mono`
- **Node.js 22+**（开发时需要；运行时 Electron 自带）
- Windows + Godot 4.x 为当前发布平台；macOS / Linux 不在 CI 矩阵内

## 四、常用命令

锁文件在 `apps/desktop/package-lock.json`，安装在该目录执行：

```bash
cd apps/desktop
npm install
```

根目录便捷脚本（`package.json` 转发）：

```bash
npm run desktop:dev            # Electron 开发（electron-vite dev）
npm run desktop:build          # 仅打包 out/
npm run desktop:typecheck      # tsc -p tsconfig.node.json && tsc -p tsconfig.web.json
npm run desktop:test           # 离线断言脚本（约 57 个 tsx 脚本串联，见 apps/desktop/package.json:scripts.test）
npm run desktop:smoke          # 真实模型冒烟（需本机认证）
npm run desktop:dist           # electron-builder --win --publish never（仅 NSIS 安装包）
npm run desktop:reset-tutorial # 重置教程环境（Windows 脚本）
npm run release:prepare -- x.y.z     # 改版本号 + 校验 CHANGELOG
npm run release:notes -- x.y.z        # 预览 GitHub Release 正文（minor 线起点会汇总上一线全部 patch）
npm run release:test-changelog       # 校验 CHANGELOG 抽取/汇总
npm run release:dist                 # 本机 typecheck + test + 打 Windows exe（**冒烟用**；发布源是 CI GitHub Release）
```

冒烟（需本机认证）：

```bash
npm exec --prefix apps/desktop -- tsx scripts/smoke-session.ts "D:\\path\\to\\project"
```

## 五、架构：进程边界与 IPC

三进程模型，**不要越界**：

- **`electron/main.ts`** — 持有 `SessionHost` / `GodotRpcBridge` / `AppAutoUpdater`。Pi SDK、文件系统、会话、模型、供应商、插件、用量、文档检索**全部在主进程**。
- **`electron/preload.ts`** — `contextBridge` 暴露 `window.xAgent`。`contextIsolation` 开、`nodeIntegration` 关。**新增 IPC 能力必须同步改** `apps/desktop/shared/ipc.ts` + main handler + preload（handler 一般按"分面"在 8 个 `register-*-ipc.ts` 里挂；preload 实际暴露 6 个分面对象 `workspace` / `turn` / `plan` / `session` / `prefs` / `updates` + flat 方法）。
- **`src/...`** — 纯 React renderer；通过 `window.xAgent.*` 调用主进程；**禁止**直接访问 Node API。

`apps/desktop/shared/` 是 main / renderer 共享类型与逻辑（`ipc.ts` 工具名、`mode-tools.ts` 模式白名单、`transcript/` 流式映射）。

## 六、关键不变量（Agent 改动前必须先确认）

这些是产品契约，破坏会让用户数据丢、安全模型失效或性能退化：

### 6.1 持久化与隔离

所有 X-agent 数据落在 `~/.pi/agent/` 下；与 Pi CLI **共用** `auth.json` / `models.json`，其余**隔离**：

| 路径 | 用途 |
|---|---|
| `x-agent.json` | 客户端偏好 |
| `x-agent-providers.json` | 供应商档案（API Key 尽量 `safeStorage` 加密；启用时明文写入 Pi `auth.json`） |
| `x-agent-godot-rpc.json` | Godot RPC endpoint（含握手 token；插件需配套更新） |
| `x-agent-packages.json` | Packages 安装记录 |
| `x-agent-usage.json` | 用量汇总 |
| `x-agent/sessions/` | 本应用会话（与 Pi CLI `sessions/` 分开） |
| `x-agent/checkpoints/` | Shadow Git 工作区检查点（按项目隔离，**不写用户 `.git`**） |
| `x-agent/plans/` | Plan Mode 默认计划文件（可"保存到项目"迁至 `<cwd>/.pi/plans/`） |
| `x-agent/goals/` | Goal Mode 跨恢复日记（按 session 路径哈希；删会话时清理） |

prefs / usage / provider / auth / godot-rpc **必须原子写**（`lib/atomic-write.ts` 的 tmp + rename）；prefs 与 usage 走 `withStoreLock(path, ...)` 串行化（与 provider 同模式）。safeStorage 不可用时启动一次 probe，UI 横幅告知"密钥以明文存储"。

### 6.2 撤回 / Shadow Git

撤回走 `retract-orchestrator.ts`（abort → scan → navigate → 文件还原 → 剪枝 → history replace）。**优先**用 Shadow Git 检查点（`shadow-checkpoints.ts`，独立 `GIT_DIR=` 到 `~/.pi/agent/x-agent/checkpoints/`，**不污染用户** `.git`）；无 Git 时降级为 `TurnFileTracker` 还原 `write` / `edit` 字节基线。

关键时序：Pi 在 `message_end` 之后才 `appendMessage`，active user / Shadow pre **必须在 append 之后绑定**（`tool_execution_start` / `queueMicrotask`），不能在 `message_start` 取 leaf。

### 6.3 会话模式硬闸

会话模式（`apps/desktop/electron/agent/session-mode/`）互斥切换，**用户切换模式时硬闸重排工具集**：

- **Agent** — 默认工具白名单（bash/write/edit 等）
- **Ask（调研）** — 只读 + read-only bash；硬闸关 `write` / `edit` / `write_plan`；bash 仅放行只读命令且路径须落在项目 cwd 内（**不写回设置**）
- **Plan** — Ask 集 + `write_plan`；todo 勾选 / `<clarify>` 多题点选后"发送所选" / Shift+Tab 循环模式
- **Goal** — 完成条件 + 独立评估；轮次 + token 双预算（`goalMaxTurns` / `goalMaxTokens`）、暂停/继续、评估失败自动暂停

工具名常量见 `shared/mode-tools.ts`、模式提示见 `shared/mode-prompt.ts`、撤回前的确认与风险提示在 `RetractConfirmModal.tsx`。

### 6.4 CWD 沙箱

`electron/agent/cwd-sandbox.ts` 解析项目内相对路径，**拒绝逃出 cwd**。`plan-tools` 与 `bash-readonly` 也走同一沙箱（Windows 大小写归一化）。Agent 模式下 Pi `bash` 仍可能访问更广路径——这是已知边界，不要无脑承诺安全。

### 6.5 安全

- API Key：`safeStorage` 加密优先；启用时明文同步 Pi `auth.json`
- 工具：默认开启 `bash` / `write` / `edit`；Ask / Plan 模式硬闸关 write/edit
- 外链：`external-url.ts` 拒绝 IPv4-mapped IPv6 / link-local / ULA / zone-id；`will-navigate` 拒绝非本应用 `file:`
- Godot RPC：仅监听 `127.0.0.1`；endpoint 含共享 token，插件 `editor_ready` 握手校验后才接受调用；method allowlist
- Packages：`pi install` 跳过 npm lifecycle scripts；注意供应链
- 单实例锁

## 七、Godot 集成

- **RPC 桥**：`.electron/agent/godot-rpc-bridge.ts` 多客户端 id / 活动选路；默认端口 `8765`，回退 `8765–8774`
- **协议**：`.shared/godot-rpc.ts`；**Addon**：`packages/godot-editor-rpc/addons/x_agent_rpc/`
- **错误缓冲**：`run_current_scene` / `play_main_scene` 短时收集（Output ERROR/WARN、调试器 Errors）；插件**不**因报错自动停止
- **工具**：`GODOT_TOOLS` 默认**关闭**，需在 设置 → 工具 勾选；调用通过 `godot-tools.ts` 转发到桥
- **文档**：`packages/godot-pi/skills/godot-docs-4-7`（仅 Godot 项目自动索引）；不经过 RPC
- **多编辑器**：每个 TCP 连接分配 `clientId`，请求发往活动客户端或在调用时显式 `clientId`
- **握手 token**：桥每次 `start` 在 endpoint JSON 写入一次性 token；旧版插件（无 token 字段）会被拒绝——需要应用内"安装/更新 RPC 插件"覆盖

UI 入口：**设置 → Godot → 编辑器连接**（侧栏 Godot 标签只读状态，完整控制在设置页）。

## 八、技能（Skills）与扩展（Extensions）发现

- **资源发现**由 Pi `DefaultResourceLoader` 完成（X-agent 不手写 system prompt）
- `skillsOverride` **故意排除** `~/.agents/skills`（避免无关技能膨胀索引）；仅用 `~/.pi/agent/skills`、项目 `.pi/skills`、已安装 Packages
- `packages/godot-pi` 是 **X-agent 原生 Pi Package**：Core 技能（`x-grill` / `x-diagnose` / `x-tdd` / `x-change-brief` / `x-handoff` / `x-glossary` / `x-review` / `x-safe-edit`）+ Godot 4.7 文档技能 + prompts + `godot_detect_project` 工具 + `/godot-rpc-status` 命令
- **Prompt 模板**（`/name`）**不**预装到 system，调用时展开为用户消息
- **技能可见**：`read` 加载 `SKILL.md` 时显示为"技能 · 名称"卡片
- 改完技能 / 插件后必须 `session.reload()` 重新发现

## 九、用量与前缀缓存

- **本地用量**：`~/.pi/agent/x-agent-usage.json`，右栏「上下文」与设置「用量」展示
- **命中率** = `cacheRead / (input + cacheRead)`（DeepSeek 等供应商对**完全一致请求前缀**计为 cache hit）
- **会破坏前缀缓存的操作**：改工具白名单、压缩、撤回/分支、流式 steer、中途改 Thinking / 模型
- **DeepSeek 代理**：经 SiliconFlow / OpenRouter / 自建 openai-compatible 中转时，激活档案会为模型 id 含 `deepseek` 的条目写入 `reasoning` + `compat.thinkingFormat: "deepseek"`；官方 `api.deepseek.com` 走 Pi 自动检测

## 十、UI 约束（Cindy 设计语言）

完整规范见 `design.md`。要点：

- 深色默认；`body[data-theme="{themeId}-{colorMode}"]` 覆盖 token；主题族：`default`（默认）/`nord` / `tokyo` / `paper` / `contrast`
- **三层 Surface**：Surface / Card / Board + 1px 边；页面内**无阴影**（modal 除外）
- **Pill 优先**：按钮 / chip / 单行 input / tab 用 `9999px`；容器 `12px`；多行 `8px`
- 颜色 / 圆角 / 阴影全部走 CSS 变量（`apps/desktop/src/styles/themes.css`），**组件 / JS 禁止硬编码**
- 字体：Inter 400/500 + JetBrains Mono；全局 13px / 1.5
- 图标用 `lucide-react`，**不用 emoji** 充当 UI 图标
- 字重仅 400 / 500；不用 600+
- 设置：左侧分页 + 可滚动内容区（`min-height: 0` + `overflow-y: auto`）
- 尊重 `prefers-reduced-motion`；功能态过渡 ≤150ms

布局壳：`TopBar → [banners] → main-row`（`Sidebar` / `Chat` / `RightPanel`，≤960px 隐藏右栏）。右栏五页签：**上下文 / 计划 / 工具 / 文件 / Godot**。

## 十一、发版流程

完整流程见 [`CLAUDE.md` §7 开发流程](CLAUDE.md#7-发版流程)。本仓库采用 **GitHub Flow**——改动走 feature 分支 + PR 合并，发版时 maintainer 在 main 上打 tag → CI 自动构建并上传 GitHub Release。

**Agent 约定**:不直接 push `main`、不主动打 tag、不提交 `apps/desktop/release/`（`.gitignore` 已排除；权威发布源是 CI 的 GitHub Release）。

## 十二、排障速查

| 现象 | 去哪里看 |
|---|---|
| "模型怎么会知道 / 不知道 X？" | `agent-context.md` 第 7 节（按层排查：AGENTS.md → 技能 → 工具 → 会话 → Packages） |
| Plan / Ask bash 被拒 | `session-mode/bash-readonly.ts`；按换行切段；拒 `$()` / 反引号 / `{}`；`godot` / `dotnet` 不视为只读 |
| 撤回后文件没还原 | `shadow-checkpoints.ts` 是否生效；无 Git 时 `turn-file-tracker.ts`；检查时序绑定 |
| 供应商密钥报错 | `provider-store` 同步；DeepSeek 代理看 `deepseekProxyModelExtras`；safeStorage probe 横幅 |
| 流式卡顿 / 无法浏览历史 | 见 0.3.11 CHANGELOG；`MarkdownBody` 流式降级 `<pre>`；`IntersectionObserver` pinned 才 follow |
| Godot 桥未连接 | 端口 `8765–8774`；插件 `editor_ready` token；`x-agent-godot-rpc.json` |
| CI build 失败 | 仅 Windows；`npm run typecheck` + `npm test` 在 `apps/desktop` 内 |

## 十三、必读索引

| 想了解… | 看哪里 |
|---|---|
| 给开发者的仓库指引 | `CLAUDE.md` |
| 模型实际看到的上下文如何组装 | `agent-context.md` |
| 领域词表 / 模块边界 | `context.md` |
| 设计系统（颜色 / 圆角 / 字体 / 动效） | `design.md` |
| 用户面功能与使用流程 | `README.md`（中文） / `README.en.md`（英文） |
| 变更与升级说明 | `CHANGELOG.md`（发版前需整理 `Unreleased`） |
| Godot 插件协议与工具表 | `packages/godot-editor-rpc/README.md` |
| 原生 Pi Package（Core + Godot 4.7 文档） | `packages/godot-pi/README.md` |
| Pi 插件类型 | `pi-plugin-guide.md` |

## 十四、编码风格

- TypeScript 严格模式（`tsconfig.node.json` + `tsconfig.web.json` 双套）
- 主进程 / preload / renderer / shared 四层别名：`@/`、`@shared/`（Node 侧仅 `@shared/`）
- 函数级注释 / 关键决策注释保留；新模块头部补一句"做什么 + 为什么"
- 中文用户面文案以 `README.md` / 设置页为准；注释 / 标识符英文为主
- **不要**在 `docs/` 下写对外约定（已 `.gitignore` 排除，CI 不可见）
- 提交前：`npm run desktop:typecheck` + `npm test`（在 `apps/desktop` 内）；然后按 [CLAUDE.md §5 PR 流程](CLAUDE.md#5-pull-request-流程) 提交 PR，CI 三 job（`desktop` / `unit-test` / `e2e`）全绿后合并

---

最后更新：与 `apps/desktop/package.json` 版本同步维护；新增对外约定（模式 / 工具 / 持久化 / 安全）请同步更新本文、`context.md` 与 `CHANGELOG.md`。
