# X-agent 0.3.8 全局代码审查报告

> **审查日期**: 2026-08-01
> **目标版本**: v0.3.8（commit 10fc78c）
> **审查方式**: OCR 全文件扫描（electron/shared、src 渲染层、packages）+ 3 个专家 agent（架构 / 安全 / 性能）
> **LLM 渠道**: deepseek-v4-flash + 主线 Opus 模型
> **文件覆盖**: 161 个 TS/TSX 源文件 + 3 个 packages 文件
> **报告产出**: 6 个后台任务（OCR ×3 + Agent ×3），最终汇总于本文档
>
> **分诊更新（2026-08-01）**: 对照源码核验后，约 1/3 高优项降级或剔除；已按分诊计划落地修复。详见下方 [§0 分诊结论](#0-分诊结论核验后)。

---

## 0. 分诊结论（核验后）

### 已确认并修复

| ID | 调整后严重度 | 处置 |
|----|--------------|------|
| H-S-03 | High | 收紧 `bash-readonly`：换行切段、拒 `$()`/反引号/`${}`、移除 `godot`/`dotnet` |
| H-A-02（计数） | High | Goal 轮次/token 账本 + 撤回回滚 |
| H-A-05 | Medium | 续轮改为 settled 外 deferred `prompt`，不再嵌套 await |
| H-A-01 | Medium | `prompt`/`abort` 捕获 bundle epoch，会话切换后拒写 |
| H-S-09 | Medium | `pi install` 环境注入 `npm_config_ignore_scripts` |
| H-S-11 | Medium | Godot RPC method allowlist |
| H-S-05 | Medium | 外链拒本地/私网 host |
| H-S-14 | Low–Med | `will-navigate` 拒非本应用 `file:` |
| H-R-04 / H-R-05 / H-R-07 / H-R-08 | UX | Plan 切换清 markdown、Files 去双载、自定义分支 UI、setState 副作用外移 |
| M-R-01 | Medium | `tool_update` 忽略已 `done` |
| M-A-02 | Medium | `requestSingleInstanceLock` |
| H-P-01 | Medium | 流式 delta O(1) 尾部更新 |
| H-P-02 | 部分 | `history_replace` 指纹去重，避免无变化全量推 |

### 误报 / 过述 / 有意设计（不修）

| ID | 判定 |
|----|------|
| H-S-02 | 有意：`auth.json` 明文与 Pi CLI 共享 |
| H-R-01 | 误报：禁止删除激活供应商档案 |
| H-R-02 | 误报：`#root` 存在；缺 Error Boundary 仅为债 |
| H-A-04 | 误报：大小写折叠只清当前 provider 别名 |
| H-S-07 双加密 | 误报：`enc:v1:` 有 early-return |
| H-A-03 | 债：上帝文件，无运行时 bug |
| M-A-03 | 误报：plugin/package skills 路径一致 |
| M-R-03 | 过述：`resolveInsideCwd` 已拦路径逃逸 |

### 暂缓

H-S-01（编辑流明文 key，可选 reveal）、H-S-04 sandbox、H-S-06/10/12/13、H-PKG-01、M-A-01 SessionContext、性能 M-P-*、无障碍 M-R-05/06。

---

## 目录

1. [执行摘要](#1-执行摘要)
2. [审查方法](#2-审查方法)
3. [关键发现（高优先级）](#3-关键发现高优先级)
4. [架构层面问题](#4-架构层面问题)
5. [性能层面问题](#5-性能层面问题)
6. [渲染层 / UX 问题](#6-渲染层--ux-问题)
7. [packages 模块问题](#7-packages-模块问题)
8. [共有反模式](#8-共有反模式)
9. [建议处理顺序](#9-建议处理顺序)
10. [总体观察](#10-总体观察)
11. [附录：输出文件索引](#11-附录输出文件索引)

---

## 1. 执行摘要

本次审查覆盖 X-agent 单应用 `apps/desktop`（Electron 三进程架构：main / preload / renderer），以及附加模块 `packages/godot-pi` 和 `packages/godot-editor-rpc`。

**核心发现**：审查暴露出 5 大主题上的债务，集中在用户感知最强的安全契约与数据一致性两条线上。

| 维度 | 高优项数 | 中优项数 | 关键风险 |
|------|----------|----------|----------|
| 安全 | 14 | 13 | Plan/调研模式承诺被绕过、明文密钥穿越 IPC |
| 架构 | 5 | 4 | prompt/retract 不在串行链内，撤回可能落错项目 |
| 性能 | 5 | 8 | 流式渲染全量不可变更新、主进程同步 I/O 阻塞 |
| 渲染层 | 8 | 11 | 错误静默/竞态守卫缺失、delete 不同步父级 |
| packages | 3 | 3 | peerDeps 通配符、路径校验缺失 |

**最严重的三类问题**：

1. **Plan/调研模式硬闸可绕过**（`bash-readonly.ts`）：bash 白名单对换行、命令替换、白名单内含 `godot`/`dotnet` 等入口均无防护，直接违反产品对外的安全契约。
2. **密钥处理栈自相矛盾**：`getProviderProfile` 把整份 API Key 穿越 IPC 到 renderer，而 `auth.json` 始终明文落盘，导致 `secret-codec` 的 safeStorage 加密等价于"安全剧场"。
3. **`prompt`/`abort` 不在串行链内**：`session-host` 注释已自陈 `replaceChain` 不覆盖 prompt/retract，await 期间切项目可能让 Shadow 检查点写入错误项目的 cwd。

---

## 2. 审查方法

### 2.1 后台并行任务

6 个并行任务同时启动：

```bash
# OCR 全文件扫描（deepseek-v4-flash）
ocr scan --audience agent --path "apps/desktop/electron,apps/desktop/shared"   # 主进程 + 协议层
ocr scan --audience agent --path "apps/desktop/src"                           # 渲染层
ocr scan --audience agent --path "packages"                                   # 附加模块

# 三个专家 agent
security-engineer    → H/M/L 分级安全审查
technical-director   → 架构层面审查
performance-analyst  → 性能层面审查
```

### 2.2 审查维度

| Agent | 关注领域 |
|-------|---------|
| security-engineer | Electron 安全配置 / IPC 边界 / 密钥凭据 / 外部进程 / 文件 I/O / 模式硬闸 |
| technical-director | 进程边界 / 会话生命周期 / Provider 路由 / 状态管理 / Mode 系统 / Godot RPC |
| performance-analyst | 流式渲染 / 长列表 / 会话恢复 / Shadow Git / 上下文压缩 / IPC 流量 |

### 2.3 优先级分类

- **高（H）**：明显 bug、安全问题、清晰错误，或有精确修复建议
- **中（M）**：合理的担忧但依赖上下文，或需手动实现的修复
- **低（L）**：可能是误报、缺乏上下文、nitpick —— 本报告直接剔除

---

## 3. 关键发现（高优先级）

### 3.1 安全

#### H-S-01 `getProviderProfile` 把明文 API Key 整份送回 renderer

**位置**：`apps/desktop/electron/ipc/register-provider-ipc.ts:22-24`、`shared/ipc.ts:1094`、`ProvidersSettingsPage.tsx:188`

**问题**：apiKey 通过 contextBridge 全量穿越 IPC 抵达 renderer，存在于 React state、DevTools、可见 form。`listProviderProfiles` 已经走 `apiKeyHint` 掩码，编辑流却绕过它。

**风险场景**：renderer 进程（含 `<script>` 注入、DevTools、attached debugger、第三方 widget、错误地把 `apiKey` 写入 `localStorage` / `console.log`）都能读到完整密钥。

**修复方向**：拆分为 `getProviderProfileForEdit`（仅 `hasKey: boolean`）+ `setProviderApiKey`（写）+ `revealProviderApiKey`（可选"显示"）。renderer 永不持久化明文。

---

#### H-S-02 `auth.json` 始终明文写，与 `secret-codec` 自相矛盾

**位置**：`apps/desktop/electron/agent/provider-store.ts:877-882`

**问题**：`safeStorage` 加密仅作用于 `x-agent-providers.json`；`~/.pi/agent/auth.json` 是 Pi CLI 直读的文件，必走明文。

**风险场景**：磁盘备份、文件同步（OneDrive / iCloud / Dropbox）、其他以该用户运行的工具都能直接读到明文。

**修复方向**：写入前用 `secret-codec` 的 v1 envelope 加密 `auth.json`；或显式提示用户"密钥以明文与 Pi CLI 共享"并给出 opt-in 的加密档位。

---

#### H-S-03 Plan/调研模式 bash 白名单可被绕过

**位置**：`apps/desktop/electron/agent/bash-readonly.ts:8-52, 102-108, 216-231`、`shared/ipc.ts:209`

**三条独立旁路**：

1. `splitShellSegments` 不切 `\n`：`ls\nrm -rf build` 中 firstToken 是 `ls`，整串放行
2. `$(...)`/反引号从未展开：`echo $(rm -rf build)` 直接通过
3. `godot`/`dotnet` 误入 `READONLY_COMMAND_HEADS`：`godot --headless --script evil.gd`、`dotnet run` 被视为只读

**风险场景**：产品对外承诺"硬闸关闭 write/edit，bash 仅放行只读命令"。当前实现是启发式黑名单 + 白名单头部，任一绕过都使承诺失效。

**修复方向**：Plan 模式直接不给 `bash`，只留 read/grep/glob。"只读 shell"是个模糊地带，干脆从契约里删掉。

---

#### H-S-04 主窗口 `sandbox: false`

**位置**：`apps/desktop/electron/main.ts:120-125`

**问题**：`contextIsolation: true` 是底线，但 `sandbox: false` 让 preload 能 `require('child_process')` —— XSS 污染 → RCE 的链路被打通。

**修复方向**：当前 preload 仅用 `ipcRenderer.invoke`，可直接打开沙箱。

---

#### H-S-05 `openExternalUrl` 接受任意 http(s) 主机

**位置**：`electron/main.ts:53-69`、`electron/app-runtime.ts:213-215`

**问题**：未设置 CSP meta，XSS 注入即可调 `window.xAgent.openExternalUrl("https://attacker/?...")` 钓鱼。

**修复方向**：renderer 加 strict CSP；`openExternalUrl` 默认 host 允许列表（github / 各 vendor 官方域）。

---

#### H-S-06 Godot RPC 协议完整性

**位置**：`electron/agent/godot-rpc-bridge.ts:322-360, 184-194, 131-158`

**问题**：
- 任何已认证 client 都能伪 response（id 是 `randomUUID`，难猜但同 box 可喷射 DoS）
- `resolveClient` 隐式回退到 `clients.values().next()` —— 插入序首项，多编辑器同时连时目标不确定
- `x-agent-godot-rpc.json` 含 token，umask 默认 022 → 本机其他用户可读
- `removeClient` 不 reject 该连接的 pending，工具调用挂满 8–23 秒超时

**修复方向**：pending 按 clientId 分桶并随 close 拒绝；显式活动客户端；`writeFileSync(..., { mode: 0o600 })`。

---

#### H-S-07 密钥处理栈一致性问题

**位置**：`apps/desktop/electron/agent/secret-codec.ts`、`provider-store.ts`、`shared/ipc.ts:821`

**问题**：
- `secret-codec.decryptSecret` 失败静默返回 `""`，把后续写盘动作变成"明文落盘"
- 把 `enc:v1:` 前缀也认作需加密
- `profile.key.trim()` 又会截断真实密钥
- `provider-store` 把任意含 `key`/`apiKey` 字段的对象当 API Key，OAuth/其它凭据被静默错型

---

#### H-S-08 Shadow Git 路径校验

**位置**：`apps/desktop/electron/agent/shadow-git.ts:202-230, 524`

**问题**：
- `withNestedGitDisabled` 重命名 `.git → .git.__xagent_shadow__`，并发 + 项目内 `git init`/`git commit` 冲撞会留下僵文件
- `destroy()` 未校验 `gitDir` 在 `getCheckpointsRoot()` 下，可删除任意路径
- 跟 SHA 直接来自 `revParse` 返回值（持久化 JSON 反序列化路径），恶意 SHAs 可注入

---

#### H-S-09 `installPackage` 不传 `--ignore-scripts`

**位置**：`apps/desktop/electron/agent/package-manager.ts:430-505`

**问题**：`pi install <evil-path>` 会执行该包 `scripts.install/postinstall`。npm 全局安装用了 `--ignore-scripts`，pi 安装忘了。

---

#### H-S-10 SSRF：`fetchProviderModels` 不限制 host

**位置**：`electron/agent/model-fetch.ts:135-209`

**问题**：`http://169.254.169.254/...`、`http://localhost:9200/_cat/health` 之类都可作为 `baseUrl`。`Authorization: Bearer <key>` 同时泄露给 SSRF 目标。

---

#### H-S-11 `godotRpcRequest` 允许任意 addon RPC

**位置**：`apps/desktop/electron/ipc/register-godot-ipc.ts:53-65`

**问题**：renderer 可调 `shell_open` 等任意 Godot addon RPC。

**修复方向**：在 `godot-rpc-bridge.ts` 维护已知 method allowlist（沿 `godot-tools.ts` 列表）。

---

#### H-S-12 文档缓存 zip-slip + 平台不兼容

**位置**：`electron/agent/godot-docs-cache.ts`

**问题**：
- `tar -xf` 解用户提供的 zip，且无 entry 校验 → zip-slip 写任意路径
- GNU tar 在 Linux 不读 zip，导入路径在主力桌面平台直接坏
- `safeRm` 吞错，`removeDocsBranch` 永远"成功"

---

#### H-S-13 prompt 注入面

**位置**：`shared/mode-prompt.ts:56`、`electron/agent/goal-evaluator.ts`

**问题**：`wrapWithModeBlock` 不转义 `</mode>`，LLM 输出含 `</mode>` 会提前结束块；`goal-evaluator` 把不可信内容 verbatim 塞进评估 prompt，无 instruction boundary。

---

#### H-S-14 Will-navigate 允许 file:// 协议

**位置**：`apps/desktop/electron/main.ts`（will-navigate handler）

**问题**：特权 preload 桥接窗口允许 `file:` URL，被攻陷的 renderer 可导航到攻击者控制的本地文件。需在 will-navigate handler 中拒绝 `file:` 协议或仅允许本应用托管的 html。

---

### 3.2 架构（高优先级）

#### H-A-01 `prompt`/`abort` 不在 `runReplaceExclusive` 串行链内

**位置**：`apps/desktop/electron/agent/session-host.ts:114-115, 249-256, 1094-1117`

**问题**：注释已自陈"not prompt/abort"。`await session.prompt()` 期间 `openProject`/`resumeSession`/`deleteSession` 完成 dispose，结果是新 prompt 落到已 `dispose()` 的 session；最坏把 Shadow 检查点写进错误项目的 cwd。

**修复方向**：bundle 改为带 epoch 的不可变句柄；`maybeAutoTitleSession` 已有的 `this.bundle !== bundle` 模式（420/436）推广到 prompt/retract。

---

#### H-A-02 Goal 完成条件自评 + 撤回失同步

**位置**：`electron/agent/session-mode.ts:690-715`

**问题**：
- 模型用自己的输出给自己打分（self-bias）
- 撤回后 `goal.turns/tokensUsed` 内存计数器不回滚，预算被双计
- `maxTurns=20` 时评估自身调用 `completeSimple` 产生的 token 完全在预算外

**修复方向**：评估用结构化摘要 + 文件变更集，独立低成本模型；turn/token 从 session entryId 派生（撤回自动一致）。

---

#### H-A-03 `provider-store.ts` 是 1484 行的上帝文件

**位置**：`electron/agent/provider-store.ts:52-202, 221-596, 813-833, 877-881, 1231-1399`

**问题**：六件事挤一起：预设目录、DeepSeek 特化、档案 CRUD、Pi 文件写入、cc-switch 导入（自研 SQLite 解析）、id slug 推断。违反项目自己的 800 行上限。

---

#### H-A-04 Provider id 大小写折叠删除

**位置**：`provider-store.ts`

**问题**：`pruneStaleProviderKeys` 大小写折叠删除 —— `DeepSeek` 与 `deepseek` 共存时会被删掉其中一个。slug 冲突是设计层未解决问题。

---

#### H-A-05 Goal 续轮用递归而非循环

**位置**：`session-mode.ts:768-771`

**问题**：`await prompt()` 之前已 reset flag，新一轮在旧一轮栈帧内嵌套；`finally` flag 复位、暂停语义都难追。改为外层 while + 单状态机。

---

### 3.3 性能（高优先级）

#### H-P-01 chat-store 流式全量不可变更新

**位置**：`src/stores/chat-store.ts`、渲染层 `ChatTranscript.tsx`

**问题**：每个 `text_delta`/`thinking_delta` 走 `findIndex`+`[...items]`+ 新字符串；流期间每秒数十次重建整棵 `ChatItem[]`。`Memo` 失效因 `item` 引用变；`MarkdownBody` 重解析整块。

---

#### H-P-02 `turn_end` 全量 history 重建 + IPC 全量推

**位置**：`electron/agent/session-event-bridge.ts:137, 362`、`transcript-mapper.ts`

**问题**：回合末 `branchEntriesToHistory` 全量重映射 + IPC 全量推送；renderer 整数组替换，virtualizer 重排键。

---

#### H-P-03 Shadow Git 阻塞主进程

**位置**：`electron/agent/shadow-git.ts`

**问题**：`commit()` 串行 `git add -A` → `status` → `commit`，全 `await`，每个 turn 末必触发。大项目可达数秒。

---

#### H-P-04 长列表 `displayItems.filter` 每次重算

**位置**：`src/components/ChatTranscript.tsx`

**问题**：不可变 spread 导致 filter 每个 delta 跑 O(n)；virtualizer estimateSize 72px 固定，长 bubble 跨行 layout 抖动。

---

#### H-P-05 ToolCard `args/result` 主+IPC+renderer 三次序列化

**位置**：`src/components/ChatTranscript.tsx`、`transcript-mapper.ts`

**问题**：`truncateTranscript` → IPC → `formatMaybeJson` → `MarkdownBody` 解析；流中每 tool update 数十次。

---

### 3.4 渲染层（高优先级）

#### H-R-01 deleteProfile 不同步父级

**位置**：`src/components/settings/ProvidersSettingsPage.tsx:414`

**问题**：删除激活档案后，`onProvidersChanged` 没被调，TopBar 持续显示已删除的供应商。

---

#### H-R-02 #root 缺失 = 整个应用静默失败

**位置**：`src/main.tsx:7`

**问题**：`createRoot(document.getElementById("root")!)` —— 没有 error boundary 包裹 `<App />`，渲染错误即白屏无回退。

---

#### H-R-03 `compactSession` 双击并发

**位置**：`src/components/right-panel/ContextTab.tsx:366`

**问题**：禁用状态依赖 IPC 返回后才更新；本地 `useRef` 守门缺失。

---

#### H-R-04 Plan 切换时旧 todo 仍渲染

**位置**：`src/components/right-panel/PlanTab.tsx:58`

**问题**：`usePlanSession` 设 `loading=true` 但不清空 markdown，列表切换时短暂显示上份计划。

---

#### H-R-05 FilesTab 刷新双调用

**位置**：`src/components/right-panel/FilesTab.tsx:104-108`

**问题**：手动 `void load()` + `setEntries(null)` 再次触发 `useEffect`，同一目录并发两次 IPC。

---

#### H-R-06 ToolsTab detail effect stale frame

**位置**：`src/components/right-panel/ToolsTab.tsx:102-105`

**问题**：切换工具后 `detailArgs/detailResult` 只 post-paint 重置，过渡帧里 `copyAll` 拷错内容到错标题。

---

#### H-R-07 GodotSettingsPage 自定义分支被立即当成 no-op

**位置**：`src/components/settings/GodotSettingsPage.tsx:535-539`

**问题**：`__custom__` 选中后 `godotDocsSetBranch` 调一次，UI 无变化，看起来"自定义选项坏了"。

---

#### H-R-08 ProvidersSettingsPage 在 `setState` updater 里副作用

**位置**：`src/components/settings/ProvidersSettingsPage.tsx:512-521`

**问题**：`StrictMode` 下双跑，react state 与外部资源会离奇不一致。

---

## 4. 架构层面问题

### 4.1 中优先级架构问题

| 编号 | 位置 | 问题摘要 |
|------|------|---------|
| M-A-01 | `session-host.ts:106-135` | 状态全部挂在 `SessionHost` 单例，阻塞多 tab。`toolDetails`/`fileTracker`/`shadowCheckpoints`/`sessionMode`/`retractOrchestrator` 本质是 session 作用域，需收进 `SessionContext` |
| M-A-02 | `app-runtime.ts:236-238` | 单实例锁 + 原子写缺失；多实例会并发写 `x-agent-*.json` + checkpoints 目录 |
| M-A-03 | `plugin-host.ts` vs `package-manager.ts` | Plugin vs Package 双源不一致 —— `package.json#pi.skills` 自定义路径 vs 硬编码 `./skills` |
| M-A-04 | `godot-docs-cache.ts:475` | 文档缓存仅 `index.rst 存在` 判定就绪，截断/部分复制均接受 |
| M-A-05 | `right-panel-store.ts` | 返回 live internal state by reference，绕过 subscribers 和 storeVersion |

---

## 5. 性能层面问题

### 5.1 中优先级性能问题

| 编号 | 位置 | 问题摘要 |
|------|------|---------|
| M-P-01 | `prefs.ts` | `patchPrefs` 同步 read-modify-write，每次切换模型/思考/工具同步阻塞 |
| M-P-02 | `usage-store.ts:98` | 每回合末 `recordTurnUsage` 全 read+write，无缓存/锁/队列 |
| M-P-03 | `transcript-mapper.ts` | `branchEntriesToHistory` 恢复阻塞，千条 branch 双扫 |
| M-P-04 | `context-breakdown.ts` | 三次正则 + 每段 token 估算，右栏刷新重算 |
| M-P-05 | `shadow-git.ts` | `findNestedGitEntries` 同步递归，未按 cwd 缓存 |
| M-P-06 | `turn-file-tracker.ts` | `captureBeforeTool` 同步读，最大 2MB/file |
| M-P-07 | `session-event-bridge.ts` | IPC `usage_update` 频率过高，每回合末/compaction/模型切换都推完整 snapshot |
| M-P-08 | `plugin-host.ts`、`exclude-agents-home-skills.ts` | 插件/技能每次 IPC 同步扫 fs |

---

## 6. 渲染层 / UX 问题

### 6.1 中优先级渲染层问题

| 编号 | 位置 | 问题摘要 |
|------|------|---------|
| M-R-01 | `chat-store.ts` | `tool_update` 无 `done` 守卫，late update 覆盖完成态 |
| M-R-02 | `MarkdownBody.tsx` | react-markdown v10 默认不净化，`javascript:`/`data:` 链接可渲染 → XSS |
| M-R-03 | `lib/expandAtPaths.ts` | 接受 `..` / 绝对路径进入 project-file IPC |
| M-R-04 | `lib/group-sessions.ts` | `s.cwd.trim()` 无 guard 触发 throw |
| M-R-05 | `styles/app.css`、`themes.css` | `--focus-ring-soft` 仅颜色无几何 → 不可见 ring；`:focus-visible { outline: none }` 全局破坏 forced-colors |
| M-R-06 | `ConfirmDialog` / `RetractConfirmModal` / `SettingsPanel` | modal 不 trap focus；RetractConfirmModal 无 Escape；SelectMenu/SkillSlashMenu 不设 `aria-activedescendant` |
| M-R-07 | `SettingsNotice.tsx`、`useColumnResize.ts`、`RightPanel.tsx` | render 阶段写 ref/store、丢弃 `useSyncExternalStore` snapshot |
| M-R-08 | `GeneralSettingsPage.tsx` | `goalMaxTurns`/`goalMaxTokens` 不 clamp 直接写，0 也发送 |
| M-R-09 | `plan-todos.ts`、`plan-clarify.ts` | markdown code-fence 内 plan todos 误命中；stateful 全局 regex |
| M-R-10 | `user-message-files.ts` | `FILE_BLOCK_RE` 二次复制；`</file>` 嵌入打破块 |
| M-R-11 | `useProjectReadiness` / `useAutoCompact` / `useUpdateStatus` / `PluginsPage` | 慢 IPC 响应覆盖新项目；闭包 stale sessionId；插件 openItem 错路径 |

---

## 7. packages 模块问题

### 7.1 高优先级 packages 问题

#### H-PKG-01 `godot-helpers.ts` 路径归一缺失

**位置**：`packages/godot-pi/extensions/godot-helpers.ts:35-36, 48, 49-51`

**问题**：
- `params.path || ctx.cwd` 不校验 → 相对路径被加到 extension 进程 cwd 而非 session cwd
- `readFileSync(projectFile, 'utf8')` 无 try/catch → TOCTOU/权限丢原始栈
- `project.godot` 三个 regex 不去注释行、不 anchor 到 `[application]`、不处理 `\"` 转义

---

### 7.2 中优先级 packages 问题

| 编号 | 位置 | 问题摘要 |
|------|------|---------|
| M-PKG-01 | `packages/godot-pi/package.json` | peerDeps 全 `*`，违反 pinning 规则 |
| M-PKG-02 | `packages/godot-pi/scripts/check-skills.mjs:39, 53, 72, 103` | 自实现 YAML + README 扫 —— quoted name 失败；block/folded description 失败；BOM 破坏 frontmatter；README 链接形式被忽略 |

---

## 8. 共有反模式

跨多个文件/多个模块反复出现的反模式列表，建议作为后续 PR 的统一修复主线。

| 反模式 | 出现位置 |
|--------|---------|
| `=== null`/`== null` 混用 | `useAutoCompact.ts`、`select-menu-scroll.ts`、`skill-tool.ts`、`right-panel-store.ts`、`ready-checklist.ts`、`ChatPanel.tsx` |
| 路径校验不完整 | `cwd-sandbox.ts`、`bash-readonly.ts`、`exclude-agents-home-skills.ts`、`shadow-git.ts`、`turn-file-tracker.ts`、`shared/project-path.ts`、`godot-docs-cache.ts` |
| 错误静默 / `safeRm void` / `catch {}` | `godot-docs-cache.ts`、`secret-codec.ts`、`usage-store.ts`、`prefs.ts`、`session-host.ts`、`auth-check.ts`、`session-usage.ts`、`model-fetch.ts`、`session-event-bridge.ts` |
| 非原子文件系统写 | `prefs.ts`、`usage-store.ts`、`goal-journal.ts`、`auth-check.ts`、`bash-check.ts`、`turn-file-tracker.ts` |
| TypeScript 类型做运行时信任 | `auth-check.ts`、`bash-check.ts`、`goal-evaluator.ts`、`plugin-host.ts`、`godot-docs-tools.ts`、`model-context.ts` |
| Windows / POSIX 兼容 | `bash-check.ts`、`cwd-sandbox.ts`、`godot-docs-cache.ts`、`pi-cli.ts`、`turn-file-tracker.ts`、`shadow-git.ts` |
| 误导性 API 契约 | `godot-addon-install.ts#enabled`、`project-fs.ts#truncated`、`transcript-mapper.ts#truncateTranscript`、`session-event-bridge.ts`、`shared/godot-rpc.ts#clientId` |
| 主进程无界资源使用 | `git-exec.ts`、`auto-updater.ts`、`godot-docs-search.ts`、`context-breakdown.ts` |

---

## 9. 建议处理顺序

按 ROI（投入/收益比）排序，每批可在独立 PR 中落地：

### 第一批：安全契约（用户感知最强）
- H-S-01：拆分 `getProviderProfile` IPC
- H-S-02：`auth.json` 加密档位
- H-S-03：Plan 模式去掉 bash 工具
- H-S-04：主窗口 `sandbox: true`
- H-S-05：`openExternalUrl` 加 host 白名单 + renderer CSP

### 第二批：数据错位
- H-A-01：epoch 句柄串行化 prompt/retract
- H-P-02：`turn_end` 增量 history 协议
- H-R-01：`tool_update` `done` 守卫

### 第三批：Goal 正确性
- H-A-02：Goal 评估用结构化摘要 + 独立模型
- H-A-05：续轮改为 while 循环

### 第四批：provider-store 重构
- H-A-03：拆分 1484 行上帝文件
- H-A-04：Provider id 改 uid + label 分离
- H-S-07：密钥处理栈一致化

### 第五批：Godot RPC 收紧
- H-S-06：pending 按 clientId 分桶 + mode 0o600
- H-S-11：addon RPC allowlist
- H-PKG-01：`godot-helpers.ts` 路径归一 + try/catch

### 第六批：快捷胜利（5–30 行/项）
- H-R-02 至 H-R-08：渲染层各类同步问题
- M-PKG-01：peerDeps 锁定
- M-PKG-02：YAML parser 替换正则

### 第七批：性能专项
- H-P-01 至 H-P-05：流式 + 主进程 I/O 集中区

### 第八批：Session 抽象（越晚越贵）
- M-A-01：`SessionContext` 抽象
- M-A-02：单实例锁 + tmp+rename 原子写

### 第九批：无障碍 / 主题
- M-R-05：焦点环几何 + 不全局覆盖 outline
- M-R-06：无障碍差距修补

---

## 10. 总体观察

### 10.1 做得好的部分（保持）

- `chat-store.applyAgentEvent` 真正的纯函数不可变归并，无派生状态冗余存储
- `bindActiveUserTurn` 对 Pi "listener 先于 append" 时序的处理（`session-event-bridge.ts:66-89`）注释清晰、三个绑定点覆盖完整
- `retract-orchestrator` 的"预扫必须先于 navigate"时序注释与实现一致，shadow → baseline 双路降级的 warning 合并是对的
- `main.ts` 的 `will-navigate` / `setWindowOpenHandler` 双重外链拦截 + 协议校验到位（除 `file:` 协议需收紧）
- IPC 通道集中在 `ipc-channels.ts` 单一注册表，93 个通道命名一致
- 会话列表只读 X-agent 会话目录；恢复须拒绝目录外路径

### 10.2 风险格局

整体 Electron 安全基线良好（contextIsolation / nodeIntegration / sandbox splash / will-navigate 白名单），但以下三点把"密钥 + 模式契约"两个用户感知最强的安全承诺给拉下了：

1. `getProviderProfile` IPC 明文密钥
2. `auth.json` 始终明文落盘
3. Plan 模式 bash 白名单可绕过

这是 0.3.8 之前务必收紧的债。架构层面的核心风险是 `prompt`/`retract` 不在串行链内带来的"撤回落错项目"数据错位。

### 10.3 性能格局

主进程 I/O 集中区（`prefs.ts` / `usage-store.ts` / `shadow-git.ts` / `turn-file-tracker.ts`）全是同步 `node:fs`，应统一抽异步队列 + 缓存层。流式 chat 是最热的渲染路径，O(1) tail-append + `history_replace` diff 化可拿到明显收益。

---

## 11. 附录：输出文件索引

本次审查的后台任务输出文件路径：

```
C:\Users\17123\AppData\Local\Temp\claude\D--UGit-X-agent--claude-worktrees-gracious-kapitsa-e00d0b\5cafad88-22d4-4980-89a6-8095e5241c40\tasks\
├── bh2cq3bl9.output                # OCR scan electron 主进程 + shared（纯文本，可 Read）
├── bp5235vd5.output                # OCR scan src 渲染层（纯文本，可 Read）
├── bwi7d56tl.output                # OCR scan packages + scripts（纯文本，可 Read）
├── a30b38933af0d342a.output        # Security review agent（JSONL transcript，不建议直接 Read）
├── a7fe2f2d619f1c20c.output        # Architecture review agent（JSONL transcript，不建议直接 Read）
└── a647e64202873d990.output        # Performance review agent（JSONL transcript，不建议直接 Read）
```

> ⚠️ agent 的 `.output` 是子代理完整 JSONL transcript，含 thinking/tool 调用，直接 Read 会爆上下文。建议从本结构化文档入手，或 Read 三个 OCR 纯文本输出来逐项核对原始评论。

---

**报告结束**
